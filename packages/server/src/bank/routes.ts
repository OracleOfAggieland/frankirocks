/**
 * Brief 046: the five bank routes. Each `apps/web/src/app/api/bank/<name>/route.ts` is `adapt(spec)` only.
 *
 *   POST /api/bank/link-token   {}                                   -> {linkToken, expiresAt}; 409 LIMIT at the limit
 *   POST /api/bank/connect      {requestId, publicToken, institutionId?, institutionName?} -> {bank, existing}
 *   GET  /api/bank/status                                            -> {banks, canConnect}; Firestore only
 *   POST /api/bank/sync         {connectorId}                        -> {bank} after one pull (or at once)
 *   POST /api/bank/disconnect   {requestId, connectorId}             -> {bank} with state "disconnected"
 *
 * Connect follows the phone call's ledger pattern (phone/outbound.ts): claim a ledger row with a deterministic ID,
 * make the outside call once and never retry an ambiguous one, then complete, fail or block the row. If anything
 * fails after the exchange and before the save, the new Item is removed at Plaid. Every answer is a `BankView`:
 * no token, no balances, no Plaid IDs. A missing or malformed setting answers CONFIG with no detail.
 */
import {
  BankConnectRequest,
  type BankConnectResponse,
  BankDisconnectRequest,
  type BankDisconnectResponse,
  BankLinkTokenRequest,
  type BankLinkTokenResponse,
  type BankStatusResponse,
  BankSyncRequest,
  type BankSyncResponse,
  type BankView,
  type Connector,
  type CoreEpoch,
  type Ledger,
  msFromTs,
  tsFromMs,
} from "@franki/core";
import { ConfigError } from "../config/env";
import { completeRequest, LEASE_MS, type RequestKey } from "../ledger/request";
import { cFields } from "../records";
import { RouteError, barrierError, dependencyError, inFlightError, parseError, scopeError, staleError } from "../routes/errors";
import { mutation } from "../routes/mutation";
import { type RouteContext, type RouteSpec, parseWith } from "../routes/runtime";
import { paths } from "../store/paths";
import type { StoredDoc, Tx } from "../store/port";
import { BANK_ENV_VARS, bankConfig } from "./config";
import { UNKNOWN_COVERAGE, bankView, canConnectMore, clientUserIdFor, connectorIdFor, getConnector, isActiveBank, listConnectors } from "./connector";
import { BankCallError, type BankPort, livePlaid } from "./plaid";
import { type BankRuntime, mergeAccounts, pullBank } from "./pull";
import { SealError, openToken, sealToken } from "./seal";

export type BankEntry = Extract<Ledger, { kind: "bank" }>;

/** 409 with reason code LIMIT: the owner already has the most banks allowed (ruling 8). */
export const bankLimitError = () => new RouteError("LIMIT", 409, 0, "bankLimit");
/** Plaid's answers to `/item/remove` that count as removed (ruling 9). */
export const REMOVED_CODES = ["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"] as const;

/** The bank port and settings for one request. A missing or malformed setting is a ConfigError (CONFIG). */
export function bankRuntime(ctx: RouteContext): BankRuntime {
  return { port: ctx.deps.bank ?? livePlaid, config: bankConfig(ctx.deps.env) };
}

const clip = (s: string | null, n: number) => (s === null ? null : s.length > n ? s.slice(0, n) : s);
const nowOf = (ctx: RouteContext) => ctx.deps.clock.read().opsClock.now;

async function coreOf(tx: Pick<Tx, "get">, uid: string) {
  const epoch = (await tx.get<CoreEpoch>(paths.core(uid, "epoch")))?.data ?? null;
  if (epoch?.barrier) throw barrierError();
  return { epoch: epoch?.epoch ?? 1, policyRev: epoch?.policyRev ?? 1 };
}

function newEntry(ctx: RouteContext, op: BankEntry["payload"]["op"], requestId: string, connectorId: string, core: { epoch: number; policyRev: number }): BankEntry {
  const at = tsFromMs(nowOf(ctx));
  return {
    ...cFields(ctx.uid, at, core.epoch, core.policyRev),
    kind: "bank",
    state: "pending",
    at,
    retainUntil: null,
    payload: { op, requestId, connectorId, outcome: null },
  };
}

/** Moves the claimed row to its end state. Best effort for failures: the route's own error is what is answered. */
async function finishRow(ctx: RouteContext, path: string, state: BankEntry["state"], outcome: BankEntry["payload"]["outcome"], tx?: Tx): Promise<void> {
  const write = async (t: Tx) => {
    const row = await t.get<BankEntry>(path);
    if (row === null || row.data.kind !== "bank") return;
    t.update(path, { ...row.data, state, updatedAt: tsFromMs(nowOf(ctx)), payload: { ...row.data.payload, outcome } });
  };
  if (tx !== undefined) return write(tx);
  try {
    await ctx.deps.store.transaction(ctx.uid, write);
  } catch {
    ctx.deps.log("bank.ledgerUnfinished", {});
  }
}

/** Removes an Item at Plaid, best effort (an orphan after a failed connect, or a duplicate link). */
async function removeQuietly(ctx: RouteContext, rt: BankRuntime, accessToken: string): Promise<void> {
  try {
    await rt.port.remove(rt.config, accessToken);
  } catch (error) {
    if (!(error instanceof BankCallError && (REMOVED_CODES as readonly (string | null)[]).includes(error.code))) ctx.deps.log("bank.removeFailed", {});
  }
}

// ---------------------------------------------------------------------------------------------
// POST /api/bank/link-token

export async function bankLinkToken(ctx: RouteContext): Promise<BankLinkTokenResponse> {
  const rt = bankRuntime(ctx);
  const all = await listConnectors({ query: (spec) => ctx.deps.store.query(ctx.uid, spec) }, ctx.uid);
  if (!canConnectMore(all)) throw bankLimitError();
  try {
    const { linkToken, expiration } = await rt.port.linkToken(rt.config, clientUserIdFor(ctx.deps.hasher, ctx.uid));
    const ms = Date.parse(expiration);
    if (!Number.isSafeInteger(ms) || linkToken.length > 512) throw new BankCallError(null, false);
    return { linkToken, expiresAt: tsFromMs(ms) };
  } catch (error) {
    if (error instanceof BankCallError) throw dependencyError(1000, "bank");
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// POST /api/bank/connect

/** Ruling 8: the same institution with a matching account (mask, type and subtype) is the same bank. */
export function findDuplicate(all: readonly StoredDoc<Connector>[], institutionId: string | null, accounts: NonNullable<Connector["bank"]>["accounts"]): StoredDoc<Connector> | null {
  if (institutionId === null) return null;
  for (const c of all) {
    const b = c.data.bank;
    if (!isActiveBank(c.data) || b === null || b.institutionId !== institutionId) continue;
    const match = accounts.some((a) => a.mask !== null && b.accounts.some((x) => x.mask === a.mask && x.type === a.type && x.subtype === a.subtype));
    if (match) return c;
  }
  return null;
}

async function viewOf(ctx: RouteContext, connectorId: string): Promise<BankView> {
  const doc = await getConnector({ get: (p) => ctx.deps.store.get(ctx.uid, p) }, ctx.uid, connectorId);
  if (doc === null) throw scopeError();
  return bankView(doc.id, doc.data);
}

/** Completes the request entry for an answer found on an earlier, finished attempt. */
async function completeWith<R extends object>(ctx: RouteContext, key: RequestKey, res: R): Promise<R> {
  await ctx.deps.store.transaction(ctx.uid, (tx) => completeRequest(tx, key, res, nowOf(ctx)));
  return res;
}

async function connectRun(ctx: RouteContext, req: BankConnectRequest, key: RequestKey, rt: BankRuntime): Promise<BankConnectResponse> {
  const { uid, deps } = ctx;
  const rowPath = paths.ledger(uid, deps.hasher.id(["bank-connect", uid, req.requestId]));
  const connectorId = connectorIdFor(deps.hasher, uid, req.requestId);

  const claim = await deps.store.transaction(uid, async (tx): Promise<{ done: BankEntry } | null> => {
    const prior = await tx.get<BankEntry>(rowPath);
    if (prior !== null) {
      const e = prior.data;
      if (e.state === "complete") return { done: e };
      if (e.state === "pending" && msFromTs(e.at) + LEASE_MS > nowOf(ctx)) throw inFlightError();
      // Failed, unconfirmed or abandoned: a public token is exchanged at most once.
      throw staleError("bankConnect");
    }
    const core = await coreOf(tx, uid);
    if (!canConnectMore(await listConnectors(tx, uid))) throw bankLimitError();
    tx.create(rowPath, newEntry(ctx, "connect", req.requestId, connectorId, core));
    return null;
  });
  if (claim !== null) {
    return completeWith(ctx, key, { bank: await viewOf(ctx, claim.done.payload.connectorId), existing: claim.done.payload.outcome === "existing" });
  }

  // The outside call, once. A refusal fails the row; an unknown outcome blocks it. Neither is retried.
  let exchanged: { accessToken: string; itemId: string };
  try {
    exchanged = await rt.port.exchange(rt.config, req.publicToken);
  } catch (error) {
    const definite = error instanceof BankCallError && error.definite;
    await finishRow(ctx, rowPath, definite ? "failed" : "blocked", definite ? "rejected" : "unconfirmed");
    throw staleError("bankConnect");
  }

  let saved: { res: BankConnectResponse; duplicate: boolean };
  try {
    const acc = await rt.port.accounts(rt.config, exchanged.accessToken);
    const institutionId = clip(acc.institutionId ?? req.institutionId, 64);
    const institutionName = clip(acc.institutionName ?? req.institutionName, 128);
    const accounts = mergeAccounts([], acc.accounts);
    const sealed = sealToken(rt.config.tokenKeys, uid, connectorId, exchanged.accessToken);
    saved = await deps.store.transaction(uid, async (tx) => {
      const core = await coreOf(tx, uid);
      const row = await tx.get<BankEntry>(rowPath);
      if (row === null || row.data.state !== "pending") throw staleError("bankConnect");
      const all = await listConnectors(tx, uid);
      const dup = findDuplicate(all, institutionId, accounts);
      const now = nowOf(ctx);
      if (dup !== null) {
        const res = { bank: bankView(dup.id, dup.data), existing: true };
        tx.update(rowPath, { ...row.data, state: "complete", updatedAt: tsFromMs(now), payload: { ...row.data.payload, connectorId: dup.id, outcome: "existing" } });
        await completeRequest(tx, key, res, now);
        return { res, duplicate: true };
      }
      if (!canConnectMore(all)) throw bankLimitError();
      const at = tsFromMs(now);
      const connector: Connector = {
        ...cFields(uid, at, core.epoch, core.policyRev),
        provider: "plaid",
        state: "syncing",
        activeGeneration: 0,
        stagingGeneration: null,
        cursor: null,
        coverage: UNKNOWN_COVERAGE,
        nextPollAt: at,
        watchExpiresAt: null,
        quota: { nextAllowedAt: at, leaseUntil: null, leaseToken: null },
        lastSuccessAt: null,
        lastError: null,
        retainUntil: null,
        bank: {
          itemId: clip(exchanged.itemId, 128)!,
          institutionId,
          institutionName,
          accounts,
          token: sealed,
          connectedAt: at,
          historicalComplete: false,
          problem: null,
          lastPullSkipped: { noCurrency: 0, badAmount: 0, badDate: 0 },
        },
        google: null,
      };
      tx.create(paths.connector(uid, connectorId), connector);
      const res = { bank: bankView(connectorId, connector), existing: false };
      tx.update(rowPath, { ...row.data, state: "complete", updatedAt: at, payload: { ...row.data.payload, outcome: "connected" } });
      await completeRequest(tx, key, res, now);
      return { res, duplicate: false };
    });
  } catch (error) {
    // Nothing was saved: the new Item must not outlive this request.
    await removeQuietly(ctx, rt, exchanged.accessToken);
    await finishRow(ctx, rowPath, "failed", "failed");
    if (error instanceof BankCallError) throw dependencyError(1000, "bank");
    throw error;
  }

  if (saved.duplicate) {
    // The existing connection answers; the second Item is removed at Plaid.
    await removeQuietly(ctx, rt, exchanged.accessToken);
  }
  // Part C follow-up 2: no pull is scheduled after the answer. Once the response is out the host may throttle the CPU,
  // and a stalled pull would hold PULL_LEASE_MS while the screen's own sync calls bounce off it. The first pull is the
  // screen's first POST /api/bank/sync (it polls while `importing`), in-request; a money read also pulls a bank that
  // has never been read (a null last success is stale).
  return saved.res;
}

export function connectBank(ctx: RouteContext, req: BankConnectRequest): Promise<BankConnectResponse> {
  const rt = bankRuntime(ctx);
  return mutation(ctx, "bankConnect", req.requestId, req, (key) => connectRun(ctx, req, key, rt));
}

/** The two Link fields may be left out of the body; a missing one reads as null. Anything else is closed. */
export function parseConnect(body: unknown): BankConnectRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw parseError("body");
  return parseWith(BankConnectRequest, { institutionId: null, institutionName: null, ...(body as Record<string, unknown>) });
}

// ---------------------------------------------------------------------------------------------
// GET /api/bank/status: Firestore only, never Plaid, writes nothing.

export async function bankStatus(ctx: RouteContext): Promise<BankStatusResponse> {
  bankConfig(ctx.deps.env);
  const all = await listConnectors({ query: (spec) => ctx.deps.store.query(ctx.uid, spec) }, ctx.uid);
  const banks = all.filter((c) => isActiveBank(c.data)).map((c) => bankView(c.id, c.data));
  return { banks, canConnect: canConnectMore(all) };
}

// ---------------------------------------------------------------------------------------------
// POST /api/bank/sync

export async function syncBank(ctx: RouteContext, req: BankSyncRequest): Promise<BankSyncResponse> {
  return { bank: await pullBank(ctx, req.connectorId, bankRuntime(ctx)) };
}

// ---------------------------------------------------------------------------------------------
// POST /api/bank/disconnect

async function disconnectRun(ctx: RouteContext, req: BankDisconnectRequest, key: RequestKey, rt: BankRuntime): Promise<BankDisconnectResponse> {
  const { uid, deps } = ctx;
  const rowPath = paths.ledger(uid, deps.hasher.id(["bank-disconnect", uid, req.requestId]));
  const claim = await deps.store.transaction(uid, async (tx) => {
    const core = await coreOf(tx, uid);
    const doc = await getConnector(tx, uid, req.connectorId);
    if (doc === null || doc.data.provider !== "plaid" || doc.data.bank === null) throw scopeError();
    const prior = await tx.get<BankEntry>(rowPath);
    if (prior !== null && prior.data.state === "pending" && msFromTs(prior.data.at) + LEASE_MS > nowOf(ctx)) throw inFlightError();
    if (prior !== null && prior.data.state === "complete") return { kind: "done" as const, doc };
    const entry = newEntry(ctx, "disconnect", req.requestId, req.connectorId, core);
    if (doc.data.state === "disconnected") {
      // Already gone (revoked, or an earlier disconnect): record it, call nothing.
      const res = { bank: bankView(doc.id, doc.data) };
      const row = { ...entry, state: "complete" as const, payload: { ...entry.payload, outcome: "disconnected" as const } };
      if (prior === null) tx.create(rowPath, row);
      else tx.update(rowPath, { ...row, createdAt: prior.data.createdAt });
      await completeRequest(tx, key, res, nowOf(ctx));
      return { kind: "answered" as const, res };
    }
    // A retry after a failed removal tries again: removing an Item twice is harmless.
    if (prior === null) tx.create(rowPath, entry);
    else tx.update(rowPath, { ...entry, createdAt: prior.data.createdAt });
    return { kind: "claimed" as const, token: doc.data.bank.token };
  });
  if (claim.kind === "answered") return claim.res;
  if (claim.kind === "done") return completeWith(ctx, key, { bank: bankView(claim.doc.id, claim.doc.data) });

  // `/item/remove` first. Not found and invalid token count as removed; anything else leaves the connection.
  if (claim.token !== null) {
    try {
      await rt.port.remove(rt.config, openToken(rt.config.tokenKeys, uid, req.connectorId, claim.token));
    } catch (error) {
      const removed = error instanceof BankCallError && (REMOVED_CODES as readonly (string | null)[]).includes(error.code);
      if (!removed) {
        const definite = error instanceof BankCallError && error.definite;
        await finishRow(ctx, rowPath, definite ? "failed" : "blocked", "notRemoved");
        if (error instanceof SealError) throw new ConfigError(BANK_ENV_VARS.tokenKey);
        if (error instanceof BankCallError) throw dependencyError(1000, "bank");
        throw error;
      }
    }
  }

  // Then the token is erased and the state is `disconnected`. Its rows stay stored (Evidence has no sanctioned
  // delete outside forget and reset) and every read is gated on the connector's state.
  return deps.store.transaction(uid, async (tx) => {
    const doc = await getConnector(tx, uid, req.connectorId);
    if (doc === null || doc.data.bank === null) throw scopeError();
    const now = nowOf(ctx);
    const next: Connector = {
      ...doc.data,
      state: "disconnected",
      cursor: null,
      quota: { nextAllowedAt: tsFromMs(now), leaseUntil: null, leaseToken: null },
      bank: { ...doc.data.bank, token: null, problem: null },
      updatedAt: tsFromMs(now),
    };
    tx.update(doc.path, next);
    const res = { bank: bankView(doc.id, next) };
    await finishRow(ctx, rowPath, "complete", "disconnected", tx);
    await completeRequest(tx, key, res, now);
    return res;
  });
}

export function disconnectBank(ctx: RouteContext, req: BankDisconnectRequest): Promise<BankDisconnectResponse> {
  const rt = bankRuntime(ctx);
  return mutation(ctx, "bankDisconnect", req.requestId, req, (key) => disconnectRun(ctx, req, key, rt));
}

/**
 * Ruling 9, for every reader of bank rows (part C): the connectors whose rows may be read. A disconnected bank's
 * rows are never read again.
 */
export async function readableBankIds(ctx: RouteContext): Promise<Set<string>> {
  const all = await listConnectors({ query: (spec) => ctx.deps.store.query(ctx.uid, spec) }, ctx.uid);
  return new Set(all.filter((c) => isActiveBank(c.data)).map((c) => c.id));
}

// ---------------------------------------------------------------------------------------------
// Route specs

export const bankLinkTokenRoute: RouteSpec<Record<string, never>> = {
  name: "bankLinkToken",
  parse: ({ body }) => parseWith(BankLinkTokenRequest, body) as Record<string, never>,
  run: (ctx) => bankLinkToken(ctx),
};

export const bankConnectRoute: RouteSpec<BankConnectRequest> = {
  name: "bankConnect",
  parse: ({ body }) => parseConnect(body),
  run: (ctx, req) => connectBank(ctx, req),
};

export const bankStatusRoute: RouteSpec<null> = {
  name: "bankStatus",
  parse: ({ query }) => {
    for (const k of query.keys()) throw parseError(`unknown parameter ${k}`);
    return null;
  },
  run: (ctx) => bankStatus(ctx),
};

export const bankSyncRoute: RouteSpec<BankSyncRequest> = {
  name: "bankSync",
  parse: ({ body }) => parseWith(BankSyncRequest, body),
  run: (ctx, req) => syncBank(ctx, req),
};

export const bankDisconnectRoute: RouteSpec<BankDisconnectRequest> = {
  name: "bankDisconnect",
  parse: ({ body }) => parseWith(BankDisconnectRequest, body),
  run: (ctx, req) => disconnectBank(ctx, req),
};

export type { BankPort };
