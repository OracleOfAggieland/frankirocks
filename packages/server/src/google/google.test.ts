// Brief 049 part B: the Google connection, end to end on the routes and the read functions, on the fake port only.
import { type Block, type Connector, type Evidence, type Ledger, tsFromMs, withConnectorDefaults } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { heroOffer } from "../routes/tool-food";
import { listTenantRows } from "../seed/clear";
import { paths } from "../store/paths";
import { ACCESS_TOKEN_G, ACCOUNT_EMAIL, ALL_SCOPES, FakeGoogle, GOOGLE_TEST_ENV, REFRESH_TOKEN, calendarEvent, gmailMessage, idTokenFor } from "../testing/fake-google";
import { TEST_ENV, callRoute, patchRecord } from "../testing/fakes";
import { OWNER, connectGoogleVia, googleRig, stateOf } from "../testing/google-rig";
import { hero } from "../testing/hero-offer";
import { resetAs } from "../testing/seed";
import { googleConfigured } from "./config";
import { googleConnectorId } from "./connector";
import { GMAIL_PARSER_VERSION_CUT, MAIL_BODY_CHARS, gmailProviderKey } from "./mail";
import { CALENDAR_SCOPE, GMAIL_SCOPE, challengeOf, stateHash } from "./oauth";
import { GoogleCallError } from "./port";
import { MAIL_SEARCH_MAX, freeTime, googleReadContext, listEvents, readableMessage, searchMail } from "./read";
import { googleConnectRoute, googleDisconnectRoute, googleStartRoute, googleStatusRoute } from "./routes";

const STATUS = { method: "GET", url: "http://localhost:3000/api/google/status", origin: null } as const;
const Q = { from: null, words: ["lease"], afterMs: null, beforeMs: null, unread: false };
type Rig = ReturnType<typeof googleRig>["rig"];

const ctxOf = (rig: Rig) => ({ uid: OWNER, deps: rig.deps, schedule: rig.sched.schedule });
async function rowsOf(rig: Rig) {
  return listTenantRows(rig.store, OWNER);
}
async function evidence(rig: Rig) {
  return (await rowsOf(rig)).filter((r) => r.path.includes("/evidence/")).map((r) => ({ id: r.id, data: r.data as Evidence }));
}
async function googleLedger(rig: Rig) {
  return (await rowsOf(rig)).filter((r) => r.path.includes("/ledger/")).map((r) => r.data as Ledger).filter((l) => l.kind === "google");
}
async function connector(rig: Rig, provider: "gmail" | "calendar"): Promise<Connector | null> {
  const d = await rig.store.get(OWNER, paths.connector(OWNER, googleConnectorId(rig.deps.hasher, OWNER, provider)));
  return d === null ? null : (d.data as Connector);
}
async function epochOf(rig: Rig) {
  return ((await rig.store.get(OWNER, paths.core(OWNER, "epoch")))!.data as { epoch: number }).epoch;
}
async function connected() {
  const { rig, google } = googleRig();
  await ensureCoreDocs(OWNER, rig.deps);
  const res = await connectGoogleVia(rig);
  expect(res.status).toBe(200);
  return { rig, google, g: googleReadContext(ctxOf(rig), await epochOf(rig)) };
}
/** Every secret the fake hands out, and the state and verifier of every start. */
function secretsIn(text: string, extra: string[] = []) {
  return [REFRESH_TOKEN, ACCESS_TOKEN_G, "4/0AQSTgQ-test-code", ...extra].filter((s) => text.includes(s));
}

describe("Google settings (ruling 27)", () => {
  it("answers CONFIG on every route with either name unset, and calls nothing", async () => {
    for (const drop of ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]) {
      const env: Record<string, string> = { ...TEST_ENV, ...GOOGLE_TEST_ENV };
      delete env[drop];
      const { rig, google } = googleRig(env);
      expect(googleConfigured(rig.deps.env)).toBe(false);
      for (const [route, body, init] of [
        [googleStartRoute, {}, {}],
        [googleStatusRoute, undefined, STATUS],
        [googleConnectRoute, { requestId: testId("c"), code: "4/x", state: "a".repeat(43) }, {}],
        [googleDisconnectRoute, { requestId: testId("d") }, {}],
      ] as const) {
        const res = await callRoute(rig, route as never, body, init);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: "CONFIG", retryAfterMs: 0 });
      }
      expect(google.calls).toEqual([]);
    }
    expect(googleConfigured({ ...TEST_ENV, ...GOOGLE_TEST_ENV })).toBe(true);
  });
});

describe("start (ruling 15)", () => {
  it("answers Google's URL and stores only the state's hash, the sealed verifier and the redirect URI", async () => {
    const { rig, google } = googleRig();
    const res = await callRoute(rig, googleStartRoute, {});
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    const state = stateOf(res.body.url);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/google/callback");
    expect(url.searchParams.get("client_id")).toBe(GOOGLE_TEST_ENV.GOOGLE_OAUTH_CLIENT_ID);
    const c = (await connector(rig, "gmail"))!;
    expect(c.state).toBe("disconnected");
    expect(c.google!.pending).toMatchObject({ stateHash: stateHash(state), redirectUri: "http://localhost:3000/google/callback" });
    const stored = JSON.stringify(await rowsOf(rig));
    expect(stored).not.toContain(state);
    expect(stored).not.toContain(url.searchParams.get("code_challenge")!);
    expect(JSON.stringify(rig.logs)).not.toContain(state);
    expect(google.calls).toEqual([]);
  });

  it("uses the configured redirect URI, and refuses a request with no allowed Origin", async () => {
    // Review S2: the redirect URI is the deployment's configured value, which the Origin must match exactly.
    const { rig } = googleRig({ ...TEST_ENV, ...GOOGLE_TEST_ENV, GOOGLE_OAUTH_REDIRECT_URI: "https://franki-web--frankirocks.us-central1.hosted.app/google/callback" });
    const hosted = "https://franki-web--frankirocks.us-central1.hosted.app";
    const res = await callRoute(rig, googleStartRoute, {}, { origin: hosted });
    expect(new URL(res.body.url).searchParams.get("redirect_uri")).toBe(`${hosted}/google/callback`);
    expect((await callRoute(rig, googleStartRoute, {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await callRoute(rig, googleStartRoute, {}, { origin: null })).status).toBe(403);
  });

  it("a later start supersedes an earlier one", async () => {
    const { rig } = googleRig();
    const a = stateOf((await callRoute(rig, googleStartRoute, {})).body.url);
    const b = stateOf((await callRoute(rig, googleStartRoute, {})).body.url);
    expect((await connector(rig, "gmail"))!.google!.pending!.stateHash).toBe(stateHash(b));
    expect(a).not.toBe(b);
  });
});

describe("connect (rulings 15 to 18)", () => {
  it("exchanges once with the stored redirect URI and the verifier behind the challenge, and saves both documents sealed", async () => {
    // Review S2: the hosted deployment's own configured redirect URI.
    const { rig, google } = googleRig({ ...TEST_ENV, ...GOOGLE_TEST_ENV, GOOGLE_OAUTH_REDIRECT_URI: "https://franki-web--frankirocks.us-central1.hosted.app/google/callback" });
    await ensureCoreDocs(OWNER, rig.deps);
    const start = await callRoute(rig, googleStartRoute, {}, { origin: "https://franki-web--frankirocks.us-central1.hosted.app" });
    const challenge = new URL(start.body.url).searchParams.get("code_challenge")!;
    // The connect comes from another allowed origin: the stored redirect URI is still the one used.
    const res = await callRoute(rig, googleConnectRoute, { requestId: testId("gc-1"), code: "4/0AQSTgQ-test-code", state: stateOf(start.body.url) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ google: { email: ACCOUNT_EMAIL, mail: "connected", calendar: "connected", needsReconnect: false, connectedAt: tsFromMs(rig.clock.read().opsClock.now) }, outcome: "connected" });
    expect(google.count("exchangeCode")).toBe(1);
    const x = google.calls[0]!.args[1] as { verifier: string; redirectUri: string };
    expect(x.redirectUri).toBe("https://franki-web--frankirocks.us-central1.hosted.app/google/callback");
    expect(challengeOf(x.verifier)).toBe(challenge);
    for (const p of ["gmail", "calendar"] as const) {
      const c = (await connector(rig, p))!;
      expect(c).toMatchObject({ provider: p, state: "connected", google: { granted: true, email: ACCOUNT_EMAIL, pending: null } });
      expect(c.google!.token).not.toBeNull();
    }
    const all = JSON.stringify([await rowsOf(rig), rig.logs, res.body]);
    expect(secretsIn(all, [x.verifier, stateOf(start.body.url)])).toEqual([]);
    expect((await googleLedger(rig)).map((l) => [l.state, l.payload])).toEqual([["complete", { op: "connect", requestId: testId("gc-1"), outcome: "connected", mail: true, calendar: true }]]);
  });

  it("a replay with the same requestId answers the same and calls nothing", async () => {
    const { rig, google } = googleRig();
    const start = await callRoute(rig, googleStartRoute, {});
    const body = { requestId: testId("gc-1"), code: "4/0AQSTgQ-test-code", state: stateOf(start.body.url) };
    const a = await callRoute(rig, googleConnectRoute, body);
    const b = await callRoute(rig, googleConnectRoute, body);
    expect(b).toMatchObject({ status: 200, body: a.body });
    expect(google.count("exchangeCode")).toBe(1);
  });

  it("connects mail and calendar independently, by what was granted", async () => {
    for (const [scope, mail, calendar] of [
      [[GMAIL_SCOPE], "connected", "off"],
      [[CALENDAR_SCOPE], "off", "connected"],
    ] as const) {
      const { rig, google } = googleRig();
      google.tokens.scope = ["openid", "email", ...scope];
      const res = await connectGoogleVia(rig);
      expect(res.body.google).toMatchObject({ mail, calendar });
      expect((await connector(rig, mail === "connected" ? "calendar" : "gmail"))!).toMatchObject({ state: "disconnected", google: { granted: false, token: null } });
    }
  });

  it("granting neither connects nothing and revokes the grant", async () => {
    const { rig, google } = googleRig();
    google.tokens.scope = ["openid", "email"];
    const res = await connectGoogleVia(rig);
    expect(res).toMatchObject({ status: 200, body: { outcome: "nothingGranted", google: { mail: "off", calendar: "off", email: null } } });
    expect(google.count("revoke")).toBe(1);
    expect((await connector(rig, "calendar"))).toBeNull();
  });

  for (const [why, setup, outcome] of [
    ["no refresh token", (g: FakeGoogle) => (g.tokens.refreshToken = null), "noRefreshToken"],
    ["a scope outside the list", (g: FakeGoogle) => (g.tokens.scope = [...ALL_SCOPES, "https://www.googleapis.com/auth/gmail.modify"]), "unexpectedScope"],
    ["an ID token for another client", (g: FakeGoogle) => (g.tokens.idToken = idTokenFor({ aud: "other.apps.googleusercontent.com" })), "badIdentity"],
    ["no ID token", (g: FakeGoogle) => (g.tokens.idToken = null), "badIdentity"],
  ] as const) {
    it(`refuses ${why}: 409, the grant revoked, nothing saved`, async () => {
      const { rig, google } = googleRig();
      setup(google);
      const res = await connectGoogleVia(rig);
      expect(res).toMatchObject({ status: 409, body: { error: "STALE" } });
      expect(google.count("revoke")).toBe(1);
      expect((await connector(rig, "gmail"))!.state).toBe("disconnected");
      expect((await googleLedger(rig)).map((l) => [l.state, l.payload.outcome])).toEqual([["failed", outcome]]);
    });
  }

  it("a refused exchange fails the row, an unknown one blocks it, and neither is sent again", async () => {
    for (const [error, state, outcome] of [
      [new GoogleCallError("refused", true), "failed", "rejected"],
      [new GoogleCallError("unknown", false), "blocked", "unconfirmed"],
    ] as const) {
      const { rig, google } = googleRig();
      google.failNext("exchangeCode", error);
      const start = await callRoute(rig, googleStartRoute, {});
      const body = { requestId: testId("gc-1"), code: "4/0AQSTgQ-test-code", state: stateOf(start.body.url) };
      expect((await callRoute(rig, googleConnectRoute, body)).status).toBe(409);
      expect((await callRoute(rig, googleConnectRoute, body)).status).toBe(409);
      expect(google.count("exchangeCode")).toBe(1);
      expect((await googleLedger(rig)).map((l) => [l.state, l.payload.outcome])).toEqual([[state, outcome]]);
    }
  });

  it("one Google account per owner: a second account is refused and its grant revoked; the first stays", async () => {
    const { rig, google } = googleRig();
    expect((await connectGoogleVia(rig, 1)).status).toBe(200);
    google.tokens = { ...google.tokens, refreshToken: "1//0gSECONDaccount", idToken: idTokenFor({ sub: "222", email: "other@example.com" }) };
    const res = await connectGoogleVia(rig, 2);
    expect(res.status).toBe(409);
    expect(google.calls.filter((c) => c.method === "revoke").map((c) => c.args[0])).toEqual(["1//0gSECONDaccount"]);
    expect((await connector(rig, "gmail"))!.google!.email).toBe(ACCOUNT_EMAIL);
  });

  it("the same account connects again over an expired grant", async () => {
    const { rig, google, g } = await connected();
    google.failNext("refresh", new GoogleCallError("invalidGrant", true));
    expect(await searchMail(g, Q)).toEqual({ ok: false, why: "expired" });
    const status = await callRoute(rig, googleStatusRoute, undefined, STATUS);
    expect(status.body.google).toMatchObject({ mail: "expired", calendar: "expired", needsReconnect: true });
    expect((await connectGoogleVia(rig, 2)).body.google).toMatchObject({ mail: "connected", calendar: "connected", needsReconnect: false });
  });
});

describe("status and disconnect (rulings 15, 18)", () => {
  it("status reads Firestore only", async () => {
    const { rig, google } = googleRig();
    expect((await callRoute(rig, googleStatusRoute, undefined, STATUS)).body).toEqual({ google: { email: null, mail: "off", calendar: "off", needsReconnect: false, connectedAt: null } });
    await connectGoogleVia(rig);
    google.calls = [];
    expect((await callRoute(rig, googleStatusRoute, undefined, STATUS)).body.google).toMatchObject({ mail: "connected", calendar: "connected" });
    expect(google.calls).toEqual([]);
  });

  it("disconnect revokes once at Google, erases both tokens, and every read stops; stored rows stay", async () => {
    const { rig, google, g } = await connected();
    google.messages.set("m1", gmailMessage("m1"));
    const found = await searchMail(g, Q);
    expect(found.ok).toBe(true);
    google.calls = [];
    const res = await callRoute(rig, googleDisconnectRoute, { requestId: testId("gd-1") });
    expect(res.body).toEqual({ google: { email: null, mail: "off", calendar: "off", needsReconnect: false, connectedAt: null } });
    expect(google.calls.map((c) => [c.method, c.args[0]])).toEqual([["revoke", REFRESH_TOKEN]]);
    for (const p of ["gmail", "calendar"] as const) expect((await connector(rig, p))!).toMatchObject({ state: "disconnected", google: { token: null, granted: false, email: null } });
    expect((await evidence(rig)).filter((e) => e.data.source === "gmail")).toHaveLength(1);
    const after = googleReadContext(ctxOf(rig), await epochOf(rig));
    expect(await searchMail(after, Q)).toEqual({ ok: false, why: "notConnected" });
    expect(await readableMessage(after, (found as { value: { read: string[] } }).value.read[0]!)).toEqual({ ok: false, why: "notConnected" });
    expect(await listEvents(after, { fromMs: rig.clock.read().opsClock.now, toMs: rig.clock.read().opsClock.now + 86_400_000 })).toEqual({ ok: false, why: "notConnected" });
    expect(google.count("revoke")).toBe(1);
    expect(google.count("refresh")).toBe(0);
  });

  it("a token Google already dropped counts as revoked; any other failure keeps the connection", async () => {
    {
      const { rig, google } = googleRig();
      await connectGoogleVia(rig);
      google.failNext("revoke", new GoogleCallError("invalidToken", true));
      expect((await callRoute(rig, googleDisconnectRoute, { requestId: testId("gd-1") })).status).toBe(200);
    }
    {
      const { rig, google } = googleRig();
      await connectGoogleVia(rig);
      google.failNext("revoke", new GoogleCallError("unknown", false));
      expect((await callRoute(rig, googleDisconnectRoute, { requestId: testId("gd-1") })).status).toBe(503);
      expect((await connector(rig, "gmail"))!.state).toBe("connected");
      // Retried, it revokes again.
      expect((await callRoute(rig, googleDisconnectRoute, { requestId: testId("gd-1") })).status).toBe(200);
      expect(google.count("revoke")).toBe(2);
    }
  });

  it("reset keeps the Google connection", async () => {
    const { rig } = googleRig();
    expect((await resetAs(rig, OWNER, "v1", "r1")).status).toBe(200);
    await connectGoogleVia(rig);
    expect((await resetAs(rig, OWNER, "v2", "r2")).status).toBe(200);
    expect((await connector(rig, "gmail"))!.state).toBe("connected");
  });

  it("reads a connector stored before the Google part as google: null", () => {
    const { google: _g, ...old } = { ...withConnectorDefaults({ bank: null } as never), google: null };
    expect(withConnectorDefaults(old as never).google).toBeNull();
  });
});

describe("reads (rulings 17, 20, 21, 23, 25)", () => {
  it("searchMail stores each message as gmail Evidence through the seed's builder, and answers no body", async () => {
    const { rig, google, g } = await connected();
    google.messages.set("m1", gmailMessage("m1"));
    google.messages.set("m2", gmailMessage("m2", { from: `Owner <${ACCOUNT_EMAIL}>`, to: "dana@example.org", subject: "Re: Lease renewal", labels: ["SENT"] }));
    const r = await searchMail(g, { from: 'Dana" OR from:x', words: ["lease", "in:anywhere"], afterMs: null, beforeMs: null, unread: true });
    expect(r.ok).toBe(true);
    const q = google.calls.find((c) => c.method === "listMessages")!.args[1] as string;
    expect(q).toBe('from:"Dana OR from x" "lease" "in anywhere" is:unread -in:spam -in:trash -category:promotions -category:social');
    // Review D11: the sender is the cleaned name and the address apart.
    const v = (r as { value: { hits: { eid: string; sender: { name: string; address: string | null }; subject: string | null; fromSelf: boolean }[]; read: string[] } }).value;
    expect(v.hits.map((h) => [h.sender.name, h.sender.address, h.subject, h.fromSelf])).toEqual([
      ["Dana Park", "dana@example.org", "Lease renewal", false],
      ["Owner", ACCOUNT_EMAIL, "Re: Lease renewal", true],
    ]);
    expect(JSON.stringify(v)).not.toContain("due Friday");
    const rows = await evidence(rig);
    const inbound = rows.find((e) => e.id === v.read[0])!.data;
    expect(inbound).toMatchObject({ source: "gmail", kind: "message", connectorId: googleConnectorId(rig.deps.hasher, OWNER, "gmail"), authorship: "unknown", body: { kind: "inline", text: "Hi, the lease renewal is due Friday. Dana" } });
    expect(new Set(inbound.fieldSlices.map((s) => s.class))).toEqual(new Set(["T"]));
    expect(new Set(rows.find((e) => e.id === v.read[1])!.data.fieldSlices.map((s) => s.class))).toEqual(new Set(["O"]));
    // The access token lived in memory only, and was refreshed once for the run.
    expect(google.count("refresh")).toBe(1);
    expect(secretsIn(JSON.stringify([await rowsOf(rig), rig.logs, v]))).toEqual([]);
  });

  it("asks for at most 8, reads the same message twice into one row, and a changed message into a new revision", async () => {
    const { rig, google, g } = await connected();
    google.messages.set("m1", gmailMessage("m1"));
    await searchMail(g, Q);
    expect(google.calls.find((c) => c.method === "listMessages")!.args[2]).toBe(MAIL_SEARCH_MAX);
    await searchMail(g, Q);
    expect((await evidence(rig)).filter((e) => e.data.source === "gmail")).toHaveLength(1);
    google.messages.set("m1", gmailMessage("m1", { subject: "Lease renewal (updated)" }));
    const r = await searchMail(g, Q);
    const rows = (await evidence(rig)).filter((e) => e.data.source === "gmail");
    expect(rows).toHaveLength(2);
    const newest = rows.find((e) => e.data.revisionOf !== null)!;
    expect((r as { value: { read: string[] } }).value.read).toEqual([newest.id]);
  });

  it("reduces HTML to text with no link, and cuts a long body at its bound", async () => {
    const { rig, google, g } = await connected();
    google.messages.set("h1", gmailMessage("h1", { text: null, html: '<p>See <a href="https://evil.example/x">the lease</a></p><script>alert(1)</script><style>p{}</style>Thanks&amp;bye' }));
    google.messages.set("h2", gmailMessage("h2", { text: "x".repeat(MAIL_BODY_CHARS + 50) }));
    const r = await searchMail(g, Q);
    const [h1, h2] = (r as { value: { read: string[] } }).value.read;
    const read1 = await readableMessage(g, h1!);
    expect(read1).toMatchObject({ ok: true, value: { body: "See the lease\nThanks&bye", cut: false } });
    const rows = await evidence(rig);
    expect(rows.find((e) => e.id === h2)!.data).toMatchObject({ parserVersion: GMAIL_PARSER_VERSION_CUT });
    expect((rows.find((e) => e.id === h2)!.data.body as { text: string }).text).toHaveLength(MAIL_BODY_CHARS);
    expect((await readableMessage(g, h2!)) as { value: { cut: boolean } }).toMatchObject({ value: { cut: true } });
  });

  it("a blocked provider ID drops: not fetched, not stored again, not returned (spec §8)", async () => {
    const { rig, google, g } = await connected();
    google.messages.set("m1", gmailMessage("m1"));
    google.messages.set("m2", gmailMessage("m2", { subject: "Other" }));
    const gmailId = googleConnectorId(rig.deps.hasher, OWNER, "gmail");
    const key = gmailProviderKey(rig.deps.hasher, gmailId, "m1");
    const now = tsFromMs(rig.clock.read().opsClock.now);
    const block: Block = {
      v: 1, uid: OWNER, rev: 1, createdAt: now, updatedAt: now, epoch: 1, policyRev: 1, rootKeys: [], rootSlices: [], contextIds: [], packetEids: [], dependsOn: [], dirty: false, dependenciesComplete: true,
      kind: "provider", state: "active", opId: testId("op"), key, boundaryMode: null, rootKey: null, providerKey: key, entityId: null, predicate: null, topicId: null, claimSimHash: null, allowedEvidenceId: null, createdFrom: null, reviewAt: null,
    };
    await rig.store.transaction(OWNER, async (tx) => tx.create(paths.block(OWNER, testId("blk")), block));
    const r = await searchMail(g, Q);
    expect((r as { value: { hits: { subject: string | null }[] } }).value.hits.map((h) => h.subject)).toEqual(["Other"]);
    expect(google.calls.filter((c) => c.method === "getMessage").map((c) => c.args[1])).toEqual(["m2"]);
    expect((await evidence(rig)).filter((e) => e.data.providerKey === key)).toHaveLength(0);
  });

  it("refuses to write once the forget epoch moved or a barrier is up", async () => {
    const { rig, google, g } = await connected();
    google.messages.set("m1", gmailMessage("m1"));
    const barrier = { opId: rig.deps.hasher.id(["op"]), phase: "fence", startedAt: tsFromMs(0), deadline: tsFromMs(rig.clock.read().opsClock.now + 60_000), queuedOps: [] };
    await patchRecord(rig.store, OWNER, paths.core(OWNER, "epoch"), { barrier } as never);
    expect(await searchMail(g, Q)).toEqual({ ok: false, why: "forgotten" });
    await patchRecord(rig.store, OWNER, paths.core(OWNER, "epoch"), { barrier: null, epoch: g.epoch + 1 } as never);
    expect(await searchMail(g, Q)).toEqual({ ok: false, why: "forgotten" });
    expect(await listEvents(g, { fromMs: 0, toMs: 86_400_000 })).toEqual({ ok: false, why: "forgotten" });
    expect((await evidence(rig)).filter((e) => e.data.source === "gmail")).toHaveLength(0);
  });

  it("invalid_grant marks both documents expired and erases their tokens", async () => {
    const { rig, google, g } = await connected();
    google.failNext("refresh", new GoogleCallError("invalidGrant", true));
    expect(await listEvents(g, { fromMs: 0, toMs: 86_400_000 })).toEqual({ ok: false, why: "expired" });
    for (const p of ["gmail", "calendar"] as const) expect((await connector(rig, p))!).toMatchObject({ state: "expired", lastError: "AUTH", google: { token: null, granted: true } });
    google.calls = [];
    expect(await searchMail(googleReadContext(ctxOf(rig), g.epoch), Q)).toEqual({ ok: false, why: "expired" });
    expect(google.calls).toEqual([]);
  });

  it("answers failed for a refresh it can't read, and unavailable with no settings", async () => {
    const { rig, google, g } = await connected();
    google.failNext("refresh", new GoogleCallError("unknown", false));
    expect(await searchMail(g, Q)).toEqual({ ok: false, why: "failed" });
    expect((await connector(rig, "gmail"))!.state).toBe("connected");
    rig.deps.env = { ...TEST_ENV };
    expect(await searchMail(g, Q)).toEqual({ ok: false, why: "unavailable" });
  });

  it("readableMessage reads only this owner's current gmail rows", async () => {
    const { rig, google, g } = await connected();
    google.events = { timeZone: "UTC", items: [calendarEvent("e1")] };
    const ev = await listEvents(g, { fromMs: Date.UTC(2026, 10, 16), toMs: Date.UTC(2026, 10, 17) });
    const eventEid = (ev as { value: { read: string[] } }).value.read[0]!;
    expect(await readableMessage(g, eventEid)).toEqual({ ok: false, why: "notConnected" });
    expect(await readableMessage(g, "../core/epoch")).toEqual({ ok: false, why: "notConnected" });
    expect(google.count("getMessage")).toBe(0);
    void rig;
  });

  it("listEvents stores events as calendar Evidence, own O and others' T, and refuses a window over 14 days", async () => {
    const { rig, google, g } = await connected();
    google.events = {
      timeZone: "America/Chicago",
      items: [
        calendarEvent("e1", { summary: "Planning" }),
        calendarEvent("e2", { summary: "Dentist", organizer: { email: "front@dentist.example", self: false }, attendees: [{ email: ACCOUNT_EMAIL, self: true, responseStatus: "accepted" }] }),
        calendarEvent("e3", { summary: "Holiday", start: { date: "2026-11-17" }, end: { date: "2026-11-18" } }),
        { id: "bad id!" },
      ],
    };
    const win = { fromMs: Date.UTC(2026, 10, 16), toMs: Date.UTC(2026, 10, 18) };
    const r = await listEvents(g, win);
    const v = (r as { value: { zone: string; events: { title: string | null; allDay: boolean; organizerSelf: boolean }[] } }).value;
    expect(v.zone).toBe("America/Chicago");
    expect(v.events.map((e) => [e.title, e.allDay, e.organizerSelf])).toEqual([
      ["Planning", false, true],
      ["Dentist", false, false],
      ["Holiday", true, true],
    ]);
    const args = google.calls.find((c) => c.method === "listEvents")!.args[1];
    expect(args).toEqual({ timeMin: "2026-11-16T00:00:00.000Z", timeMax: "2026-11-18T00:00:00.000Z", max: 50 });
    const rows = (await evidence(rig)).filter((e) => e.data.source === "calendar");
    const dentist = rows.find((e) => e.data.title === "Dentist")!.data;
    expect(dentist.fieldSlices.find((s) => s.fieldPath === "title")!.class).toBe("T");
    expect(dentist.observation).toMatchObject({ kind: "calendar", selfResponse: "accepted", organizerSelf: false });
    const holiday = rows.find((e) => e.data.title === "Holiday")!.data;
    expect(holiday.observation).toMatchObject({ allDay: true, start: "2026-11-17T06:00:00.000Z" });
    google.calls = [];
    expect(await listEvents(g, { fromMs: 0, toMs: 15 * 86_400_000 })).toEqual({ ok: false, why: "failed" });
    expect(google.calls).toEqual([]);
  });

  it("freeTime computes the gaps by code between busy events, inside the day bounds", async () => {
    const { google, g } = await connected();
    google.events = {
      timeZone: "UTC",
      items: [
        calendarEvent("a", { start: { dateTime: "2026-11-16T10:00:00Z" }, end: { dateTime: "2026-11-16T11:00:00Z" } }),
        calendarEvent("b", { start: { dateTime: "2026-11-16T13:00:00Z" }, end: { dateTime: "2026-11-16T15:30:00Z" } }),
        calendarEvent("c", { start: { dateTime: "2026-11-16T16:00:00Z" }, end: { dateTime: "2026-11-16T17:00:00Z" }, transparency: "transparent" }),
        // Review D10: an all-day event blocks unless it is transparent, as Google's all-day events are by default.
        calendarEvent("d", { start: { date: "2026-11-16" }, end: { date: "2026-11-17" }, transparency: "transparent" }),
      ],
    };
    const r = await freeTime(g, { fromMs: Date.UTC(2026, 10, 16), toMs: Date.UTC(2026, 10, 17) }, 60);
    expect((r as { value: { gaps: unknown[] } }).value.gaps).toEqual([
      { start: "2026-11-16T09:00:00.000Z", end: "2026-11-16T10:00:00.000Z" },
      { start: "2026-11-16T11:00:00.000Z", end: "2026-11-16T13:00:00.000Z" },
      { start: "2026-11-16T15:30:00.000Z", end: "2026-11-16T18:00:00.000Z" },
    ]);
  });
});

describe("the sample visit stays the sample visit (ruling 22)", () => {
  it("the hero's numbers are unchanged with Google connected and its late meetings read", async () => {
    const h = await hero();
    const s = await h.open();
    const before = await heroOffer(h.ctx, s.stamp.generation);
    expect(before?.pattern).toMatchObject({ totalCents: 18600 });
    h.rig.deps.env = { ...h.rig.deps.env, ...GOOGLE_TEST_ENV };
    const google = new FakeGoogle();
    h.rig.deps.google = google;
    expect((await connectGoogleVia(h.rig)).status).toBe(200);
    // Late, accepted, opaque meetings on nights the hero doesn't have, and on the hero's own nights, in its window.
    google.events = {
      timeZone: "America/Chicago",
      items: ["2026-10-14", "2026-10-15", "2026-10-20", "2026-10-21", "2026-10-22"].map((d, i) =>
        calendarEvent(`late${i}`, { start: { dateTime: `${d}T19:00:00-05:00` }, end: { dateTime: `${d}T20:00:00-05:00` }, attendees: [{ email: ACCOUNT_EMAIL, self: true, responseStatus: "accepted" }] }),
      ),
    };
    google.messages.set("m1", gmailMessage("m1"));
    const epoch = await epochOf(h.rig);
    const g = googleReadContext({ uid: OWNER, deps: h.rig.deps, schedule: h.rig.sched.schedule }, epoch);
    const ev = await listEvents(g, { fromMs: Date.UTC(2026, 9, 12), toMs: Date.UTC(2026, 9, 26) });
    expect((ev as { value: { events: unknown[] } }).value.events).toHaveLength(5);
    expect((await searchMail(g, Q)).ok).toBe(true);
    const after = await heroOffer(h.ctx, s.stamp.generation);
    expect(after?.pattern).toEqual(before?.pattern);
    expect(after?.line).toBe(before?.line);
  });
});
