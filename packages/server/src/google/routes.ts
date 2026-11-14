/**
 * Brief 049 ruling 15: the four Google routes. Each `apps/web/src/app/api/google/<name>/route.ts` is `adapt(spec)`
 * only, behind the Route_Guard (Firebase token; an exact Origin on every POST).
 *
 *   POST /api/google/start       {}                         -> {url, expiresAt}
 *   POST /api/google/connect     {requestId, code, state}   -> {google, outcome}
 *   GET  /api/google/status                                 -> {google}; Firestore only, never Google
 *   POST /api/google/disconnect  {requestId}                -> {google}
 *
 * Start stores one pending authorization on the owner's `gmail` document: the state's hash, the PKCE verifier sealed,
 * the redirect URI (the configured `GOOGLE_OAUTH_REDIRECT_URI`, which must be the checked Origin plus
 * /google/callback) and a 10-minute end. Connect consumes it in a
 * transaction before anything else, whatever the outcome, so a state is used at most once; a state that is another
 * owner's, used, superseded, expired or never issued answers 409 and reaches Google zero times. The exchange is made
 * once: a refusal fails the ledger row, an unknown outcome blocks it, and neither is retried. A grant that can't be
 * kept (no refresh token, a scope outside the list, no identity, another account) is revoked at Google.
 *
 * The start answer is the one answer that holds a state, inside Google's URL, because the popup must carry it; it
 * is never recorded (start takes no requestId). No other answer, no ledger row and no log line holds a token, a
 * code, a state or a verifier.
 */
import {
  type Connector,
  type CoreEpoch,
  GoogleConnectRequest,
  type GoogleConnectResponse,
  GoogleDisconnectRequest,
  type GoogleDisconnectResponse,
  GoogleStartRequest,
  type GoogleStartResponse,
  type GoogleStatusResponse,
  type Ledger,
  msFromTs,
  tsFromMs,
} from "@franki/core";
import { ALLOWED_ORIGINS } from "../auth/guard";
import { ConfigError } from "../config/env";
import { completeRequest, LEASE_MS, type RequestKey } from "../ledger/request";
import { cFields } from "../records";
import { barrierError, dependencyError, inFlightError, originError, parseError, staleError } from "../routes/errors";
import { mutation } from "../routes/mutation";
import { type RouteContext, type RouteSpec, parseWith } from "../routes/runtime";
import { SealError, seal, unseal } from "../sealed";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { GOOGLE_ENV_VARS, type GoogleConfig, googleConfig } from "./config";
import { EMPTY_GOOGLE, type GoogleDocs, type GoogleProvider, googleAccountKey, googleConnectorId, googleView, isReadableGoogle, newGoogleConnector, readGoogleDocs } from "./connector";
import { PENDING_TTL_MS, authorizationUrl, challengeOf, grantedOf, identityOf, newState, newVerifier, redirectUriFor, stateHash, stateMatches } from "./oauth";
import { GoogleCallError, type GooglePort, liveGoogle } from "./port";

export type GoogleEntry = Extract<Ledger, { kind: "google" }>;
type Outcome = NonNullable<GoogleEntry["payload"]["outcome"]>;

export interface GoogleRuntime {
  port: GooglePort;
  config: GoogleConfig;
}

/** The Google port and settings for one request. A missing or malformed setting is a ConfigError (CONFIG). */
export function googleRuntime(ctx: RouteContext): GoogleRuntime {
  return { port: ctx.deps.google ?? liveGoogle, config: googleConfig(ctx.deps.env) };
}

const nowOf = (ctx: RouteContext) => ctx.deps.clock.read().opsClock.now;
const connectorPath = (ctx: RouteContext, provider: GoogleProvider) => paths.connector(ctx.uid, googleConnectorId(ctx.deps.hasher, ctx.uid, provider));

async function coreOf(tx: Pick<Tx, "get">, uid: string) {
  const epoch = (await tx.get<CoreEpoch>(paths.core(uid, "epoch")))?.data ?? null;
  if (epoch?.barrier) throw barrierError();
  return { epoch: epoch?.epoch ?? 1, policyRev: epoch?.policyRev ?? 1 };
}

function newEntry(ctx: RouteContext, op: GoogleEntry["payload"]["op"], requestId: string, core: { epoch: number; policyRev: number }, state: GoogleEntry["state"], outcome: Outcome | null): GoogleEntry {
  const at = tsFromMs(nowOf(ctx));
  return { ...cFields(ctx.uid, at, core.epoch, core.policyRev), kind: "google", state, at, retainUntil: null, payload: { op, requestId, outcome, mail: false, calendar: false } };
}

/** Moves the claimed row to its end state. Best effort outside a transaction: the route's own error is answered. */
async function finishRow(ctx: RouteContext, path: string, state: GoogleEntry["state"], outcome: Outcome, granted: { mail: boolean; calendar: boolean } | null, tx?: Tx): Promise<void> {
  const write = async (t: Tx) => {
    const row = await t.get<GoogleEntry>(path);
    if (row === null || row.data.kind !== "google") return;
    t.update(path, { ...row.data, state, updatedAt: tsFromMs(nowOf(ctx)), payload: { ...row.data.payload, outcome, mail: granted?.mail ?? false, calendar: granted?.calendar ?? false } });
  };
  if (tx !== undefined) return write(tx);
  try {
    await ctx.deps.store.transaction(ctx.uid, write);
  } catch {
    ctx.deps.log("google.ledgerUnfinished", {});
  }
}

/** Revokes a grant at Google, best effort (a grant that can't be kept). Never logs the token. */
async function revokeQuietly(ctx: RouteContext, rt: GoogleRuntime, token: string): Promise<void> {
  try {
    await rt.port.revoke(token);
  } catch (error) {
    if (!(error instanceof GoogleCallError && error.problem === "invalidToken")) ctx.deps.log("google.revokeFailed", {});
  }
}

async function viewOf(ctx: RouteContext) {
  return googleView(await readGoogleDocs({ get: (p) => ctx.deps.store.get(ctx.uid, p) }, ctx.uid, ctx.deps.hasher));
}

// ---------------------------------------------------------------------------------------------
// POST /api/google/start

export async function googleStart(ctx: RouteContext): Promise<GoogleStartResponse> {
  const rt = googleRuntime(ctx);
  const { uid, deps } = ctx;
  // Review S2: one redirect URI per deployment. The guard has checked the Origin already; it is read again here and
  // must be exactly the configured URI's origin, so a production server never hands out another origin's callback.
  const origin = ctx.origin ?? null;
  if (origin === null || !ALLOWED_ORIGINS.includes(origin) || redirectUriFor(origin) !== rt.config.redirectUri) throw originError();
  const redirectUri = rt.config.redirectUri;
  const state = newState();
  const verifier = newVerifier();
  const now = nowOf(ctx);
  const expiresAt = tsFromMs(now + PENDING_TTL_MS);
  const gmailId = googleConnectorId(deps.hasher, uid, "gmail");
  const pending = { stateHash: stateHash(state), verifier: seal("franki-google-verifier", rt.config.tokenKeys, uid, gmailId, verifier), redirectUri, issuedAt: tsFromMs(now), expiresAt };
  await deps.store.transaction(uid, async (tx) => {
    const core = await coreOf(tx, uid);
    const path = paths.connector(uid, gmailId);
    const docs = await readGoogleDocs(tx, uid, deps.hasher);
    if (docs.gmail === null) {
      // A document that exists but is not a Google one is overwritten only through its own provider: refuse.
      if ((await tx.get(path)) !== null) throw staleError("googleStart");
      tx.create(path, { ...newGoogleConnector(uid, "gmail", now, core), google: { ...EMPTY_GOOGLE, pending } });
    } else {
      // One pending authorization: a later start supersedes an earlier one.
      tx.update(path, { ...docs.gmail.data, updatedAt: tsFromMs(now), google: { ...docs.gmail.data.google!, pending } });
    }
  });
  deps.log("google.start", {});
  return { url: authorizationUrl({ clientId: rt.config.clientId, redirectUri, state, challenge: challengeOf(verifier) }), expiresAt };
}

// ---------------------------------------------------------------------------------------------
// POST /api/google/connect

/** Thrown inside the save when another Google account is already connected (one account per owner). */
class OtherAccount extends Error {}

async function completeWith<R extends object>(ctx: RouteContext, key: RequestKey, res: R): Promise<R> {
  await ctx.deps.store.transaction(ctx.uid, (tx) => completeRequest(tx, key, res, nowOf(ctx)));
  return res;
}

/** The next stored form of one document after a connect. */
function connectedDoc(ctx: RouteContext, provider: GoogleProvider, prior: Connector | null, core: { epoch: number; policyRev: number }, x: { granted: boolean; accountKey: string; email: string | null; refreshToken: string; keys: GoogleConfig["tokenKeys"] }): Connector {
  const now = nowOf(ctx);
  const base = prior ?? newGoogleConnector(ctx.uid, provider, now, core);
  const id = googleConnectorId(ctx.deps.hasher, ctx.uid, provider);
  return {
    ...base,
    state: x.granted ? "connected" : "disconnected",
    lastError: null,
    updatedAt: tsFromMs(now),
    google: {
      accountKey: x.granted ? x.accountKey : null,
      email: x.granted ? x.email : null,
      granted: x.granted,
      token: x.granted ? seal("franki-google-token", x.keys, ctx.uid, id, x.refreshToken) : null,
      connectedAt: x.granted ? tsFromMs(now) : null,
      pending: null,
    },
  };
}

async function connectRun(ctx: RouteContext, req: GoogleConnectRequest, key: RequestKey, rt: GoogleRuntime): Promise<GoogleConnectResponse> {
  const { uid, deps } = ctx;
  const rowPath = paths.ledger(uid, deps.hasher.id(["google-connect", uid, req.requestId]));
  const gmailId = googleConnectorId(deps.hasher, uid, "gmail");

  // 1. Consume the pending authorization, whatever comes next. Nothing reaches Google before this commits.
  const claim = await deps.store.transaction(uid, async (tx) => {
    const prior = await tx.get<GoogleEntry>(rowPath);
    if (prior !== null) {
      if (prior.data.state === "complete") return { kind: "done" as const, outcome: prior.data.payload.outcome };
      if (prior.data.state === "pending" && msFromTs(prior.data.at) + LEASE_MS > nowOf(ctx)) throw inFlightError();
      throw staleError("googleConnect");
    }
    const core = await coreOf(tx, uid);
    const docs = await readGoogleDocs(tx, uid, deps.hasher);
    const pending = docs.gmail?.data.google?.pending ?? null;
    if (docs.gmail !== null && pending !== null) {
      tx.update(docs.gmail.path, { ...docs.gmail.data, updatedAt: tsFromMs(nowOf(ctx)), google: { ...docs.gmail.data.google!, pending: null } });
    }
    const usable = pending !== null && nowOf(ctx) < msFromTs(pending.expiresAt) && stateMatches(pending.stateHash, req.state);
    if (!usable) {
      tx.create(rowPath, newEntry(ctx, "connect", req.requestId, core, "failed", "badState"));
      return { kind: "refused" as const };
    }
    tx.create(rowPath, newEntry(ctx, "connect", req.requestId, core, "pending", null));
    return { kind: "claimed" as const, pending: pending! };
  });
  if (claim.kind === "done") {
    return completeWith(ctx, key, { google: await viewOf(ctx), outcome: claim.outcome === "nothingGranted" ? "nothingGranted" : "connected" });
  }
  if (claim.kind === "refused") {
    deps.log("google.connect", { outcome: "badState" });
    throw staleError("googleConnect");
  }

  let verifier: string;
  try {
    verifier = unseal("franki-google-verifier", rt.config.tokenKeys, uid, gmailId, claim.pending.verifier);
  } catch (error) {
    await finishRow(ctx, rowPath, "failed", "failed", null);
    if (error instanceof SealError) throw new ConfigError(GOOGLE_ENV_VARS.tokenKey);
    throw error;
  }

  // 2. The exchange, once, with the redirect URI stored at start. A refusal fails the row; an unknown outcome blocks it.
  let tokens: Awaited<ReturnType<GooglePort["exchangeCode"]>>;
  try {
    tokens = await rt.port.exchangeCode(rt.config, { code: req.code, verifier, redirectUri: claim.pending.redirectUri });
  } catch (error) {
    const definite = error instanceof GoogleCallError && error.definite;
    await finishRow(ctx, rowPath, definite ? "failed" : "blocked", definite ? "rejected" : "unconfirmed", null);
    deps.log("google.connect", { outcome: definite ? "rejected" : "unconfirmed" });
    throw staleError("googleConnect");
  }

  // 3. What was granted, and whose account. A grant that can't be kept is revoked.
  const refuse = async (outcome: Outcome): Promise<never> => {
    await revokeQuietly(ctx, rt, tokens.refreshToken ?? tokens.accessToken);
    await finishRow(ctx, rowPath, "failed", outcome, null);
    deps.log("google.connect", { outcome });
    throw staleError("googleConnect");
  };
  const granted = grantedOf(tokens.scope);
  if (granted === "unexpected") return refuse("unexpectedScope");
  const who = identityOf(tokens.idToken, rt.config.clientId);
  if (who === null) return refuse("badIdentity");
  if (!granted.mail && !granted.calendar) {
    // Ruling 16: granting neither connects nothing. The grant is revoked, and the answer says so.
    await revokeQuietly(ctx, rt, tokens.refreshToken ?? tokens.accessToken);
    return deps.store.transaction(uid, async (tx) => {
      const res = { google: googleView(await readGoogleDocs(tx, uid, deps.hasher)), outcome: "nothingGranted" as const };
      await finishRow(ctx, rowPath, "complete", "nothingGranted", granted, tx);
      await completeRequest(tx, key, res, nowOf(ctx));
      return res;
    });
  }
  if (tokens.refreshToken === null) return refuse("noRefreshToken");
  const refreshToken = tokens.refreshToken;
  const accountKey = googleAccountKey(deps.hasher, uid, who.sub);

  // 4. Save both documents with the row and the answer, in one transaction.
  try {
    const res = await deps.store.transaction(uid, async (tx) => {
      const core = await coreOf(tx, uid);
      const row = await tx.get<GoogleEntry>(rowPath);
      if (row === null || row.data.state !== "pending") throw staleError("googleConnect");
      const docs = await readGoogleDocs(tx, uid, deps.hasher);
      for (const d of [docs.gmail, docs.calendar]) {
        if (d !== null && isReadableGoogle(d.data) && d.data.google!.accountKey !== accountKey) throw new OtherAccount();
      }
      const x = { accountKey, email: who.email, refreshToken, keys: rt.config.tokenKeys };
      const write = (provider: GoogleProvider, prior: GoogleDocs["gmail"], on: boolean) => {
        const next = connectedDoc(ctx, provider, prior?.data ?? null, core, { ...x, granted: on });
        if (prior === null) tx.create(connectorPath(ctx, provider), next);
        else tx.update(prior.path, next);
        return next;
      };
      const gmail = write("gmail", docs.gmail, granted.mail);
      const calendar = write("calendar", docs.calendar, granted.calendar);
      const res = { google: googleView({ gmail: { path: "", id: "", data: gmail }, calendar: { path: "", id: "", data: calendar } }), outcome: "connected" as const };
      await finishRow(ctx, rowPath, "complete", "connected", granted, tx);
      await completeRequest(tx, key, res, nowOf(ctx));
      return res;
    });
    deps.log("google.connect", { outcome: "connected", mail: granted.mail, calendar: granted.calendar });
    return res;
  } catch (error) {
    // Nothing was saved: the new grant must not outlive this request.
    await revokeQuietly(ctx, rt, refreshToken);
    const outcome: Outcome = error instanceof OtherAccount ? "otherAccount" : "failed";
    await finishRow(ctx, rowPath, "failed", outcome, null);
    deps.log("google.connect", { outcome });
    if (error instanceof OtherAccount) throw staleError("googleConnect");
    throw error;
  }
}

export function connectGoogle(ctx: RouteContext, req: GoogleConnectRequest): Promise<GoogleConnectResponse> {
  const rt = googleRuntime(ctx);
  return mutation(ctx, "googleConnect", req.requestId, req, (key) => connectRun(ctx, req, key, rt));
}

// ---------------------------------------------------------------------------------------------
// GET /api/google/status: Firestore only, never Google, writes nothing.

export async function googleStatus(ctx: RouteContext): Promise<GoogleStatusResponse> {
  googleConfig(ctx.deps.env);
  return { google: await viewOf(ctx) };
}

// ---------------------------------------------------------------------------------------------
// POST /api/google/disconnect

/** Both documents with their tokens erased and their state `disconnected`. The stored rows stay, unreadable. */
function erased(c: Connector, now: number): Connector {
  return { ...c, state: "disconnected", lastError: null, updatedAt: tsFromMs(now), google: { ...EMPTY_GOOGLE, pending: c.google?.pending ?? null } };
}

async function disconnectRun(ctx: RouteContext, req: GoogleDisconnectRequest, key: RequestKey, rt: GoogleRuntime): Promise<GoogleDisconnectResponse> {
  const { uid, deps } = ctx;
  const rowPath = paths.ledger(uid, deps.hasher.id(["google-disconnect", uid, req.requestId]));
  const eraseAll = async (tx: Tx) => {
    const docs = await readGoogleDocs(tx, uid, deps.hasher);
    const now = nowOf(ctx);
    for (const d of [docs.gmail, docs.calendar]) if (d !== null) tx.update(d.path, erased(d.data, now));
    return { google: googleView({ gmail: docs.gmail && { ...docs.gmail, data: erased(docs.gmail.data, now) }, calendar: docs.calendar && { ...docs.calendar, data: erased(docs.calendar.data, now) } }) };
  };

  const claim = await deps.store.transaction(uid, async (tx) => {
    const core = await coreOf(tx, uid);
    const prior = await tx.get<GoogleEntry>(rowPath);
    if (prior !== null && prior.data.state === "pending" && msFromTs(prior.data.at) + LEASE_MS > nowOf(ctx)) throw inFlightError();
    if (prior !== null && prior.data.state === "complete") return { kind: "done" as const };
    const docs = await readGoogleDocs(tx, uid, deps.hasher);
    const holder = [docs.gmail, docs.calendar].find((d) => d !== null && d.data.google?.token != null) ?? null;
    if (holder === null) {
      // Nothing to revoke (never connected, expired, or disconnected already): erase and record, call nothing.
      const res = await eraseAll(tx);
      const row = newEntry(ctx, "disconnect", req.requestId, core, "complete", "disconnected");
      if (prior === null) tx.create(rowPath, row);
      else tx.update(rowPath, { ...row, createdAt: prior.data.createdAt });
      await completeRequest(tx, key, res, nowOf(ctx));
      return { kind: "answered" as const, res };
    }
    // A retry after a failed revoke tries again: revoking twice is harmless.
    const row = newEntry(ctx, "disconnect", req.requestId, core, "pending", null);
    if (prior === null) tx.create(rowPath, row);
    else tx.update(rowPath, { ...row, createdAt: prior.data.createdAt });
    return { kind: "claimed" as const, id: holder.id, sealed: holder.data.google!.token! };
  });
  if (claim.kind === "answered") return claim.res;
  if (claim.kind === "done") return completeWith(ctx, key, { google: await viewOf(ctx) });

  // Revoke once at Google: it removes the whole grant, so one call covers both documents.
  try {
    await rt.port.revoke(unseal("franki-google-token", rt.config.tokenKeys, uid, claim.id, claim.sealed));
  } catch (error) {
    const revoked = error instanceof GoogleCallError && error.problem === "invalidToken";
    if (!revoked) {
      const definite = error instanceof GoogleCallError && error.definite;
      await finishRow(ctx, rowPath, definite ? "failed" : "blocked", "notRevoked", null);
      if (error instanceof SealError) throw new ConfigError(GOOGLE_ENV_VARS.tokenKey);
      if (error instanceof GoogleCallError) throw dependencyError(1000, "google");
      throw error;
    }
  }

  return deps.store.transaction(uid, async (tx) => {
    const res = await eraseAll(tx);
    await finishRow(ctx, rowPath, "complete", "disconnected", null, tx);
    await completeRequest(tx, key, res, nowOf(ctx));
    deps.log("google.disconnect", {});
    return res;
  });
}

export function disconnectGoogle(ctx: RouteContext, req: GoogleDisconnectRequest): Promise<GoogleDisconnectResponse> {
  const rt = googleRuntime(ctx);
  return mutation(ctx, "googleDisconnect", req.requestId, req, (key) => disconnectRun(ctx, req, key, rt));
}

// ---------------------------------------------------------------------------------------------
// Route specs

export const googleStartRoute: RouteSpec<Record<string, never>> = {
  name: "googleStart",
  parse: ({ body }) => parseWith(GoogleStartRequest, body) as Record<string, never>,
  run: (ctx) => googleStart(ctx),
};

export const googleConnectRoute: RouteSpec<GoogleConnectRequest> = {
  name: "googleConnect",
  parse: ({ body }) => parseWith(GoogleConnectRequest, body),
  run: (ctx, req) => connectGoogle(ctx, req),
};

export const googleStatusRoute: RouteSpec<null> = {
  name: "googleStatus",
  parse: ({ query }) => {
    for (const k of query.keys()) throw parseError(`unknown parameter ${k}`);
    return null;
  },
  run: (ctx) => googleStatus(ctx),
};

export const googleDisconnectRoute: RouteSpec<GoogleDisconnectRequest> = {
  name: "googleDisconnect",
  parse: ({ body }) => parseWith(GoogleDisconnectRequest, body),
  run: (ctx, req) => disconnectGoogle(ctx, req),
};
