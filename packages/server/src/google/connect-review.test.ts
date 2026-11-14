// Brief 049 part B review fixes S3 to S8: the connection's edges. A wrong state touches nothing; a disconnect wins
// over an exchange or a read in flight; a changed sealing key still disconnects; no recorded answer keeps the
// address; and a different Google account never reads the first one's stored rows.
import { type Connector, type Evidence, type Ledger } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { listTenantRows } from "../seed/clear";
import { paths } from "../store/paths";
import { ACCOUNT_EMAIL, REFRESH_TOKEN, gmailMessage, calendarEvent, idTokenFor } from "../testing/fake-google";
import { callRoute } from "../testing/fakes";
import { OWNER, connectGoogleVia, googleRig, stateOf } from "../testing/google-rig";
import { googleConnectorId } from "./connector";
import { GoogleCallError } from "./port";
import { googleReadContext, listEvents, readableMessage, searchMail } from "./read";
import { disconnectGoogle, googleConnectRoute, googleDisconnectRoute, googleStartRoute, googleStatusRoute } from "./routes";

type Rig = ReturnType<typeof googleRig>["rig"];
const Q = { from: null, words: ["lease"], afterMs: null, beforeMs: null, unread: false };
const STATUS = { method: "GET", url: "http://localhost:3000/api/google/status", origin: null } as const;
const ctxOf = (rig: Rig) => ({ uid: OWNER, deps: rig.deps, schedule: rig.sched.schedule });
const rowsOf = (rig: Rig) => listTenantRows(rig.store, OWNER);
const epochOf = async (rig: Rig) => ((await rig.store.get(OWNER, paths.core(OWNER, "epoch")))!.data as { epoch: number }).epoch;
const gctx = async (rig: Rig) => googleReadContext(ctxOf(rig), await epochOf(rig));
async function connector(rig: Rig, provider: "gmail" | "calendar"): Promise<Connector | null> {
  const d = await rig.store.get(OWNER, paths.connector(OWNER, googleConnectorId(rig.deps.hasher, OWNER, provider)));
  return d === null ? null : (d.data as Connector);
}
const ledger = async (rig: Rig) => (await rowsOf(rig)).filter((r) => r.path.includes("/ledger/")).map((r) => r.data as Ledger);
const gmailRows = async (rig: Rig) => (await rowsOf(rig)).filter((r) => r.path.includes("/evidence/") && (r.data as Evidence).source === "gmail");
const disconnectNow = (rig: Rig, n: string) => disconnectGoogle(ctxOf(rig), { requestId: testId(n) });
const readIds = (r: unknown) => (r as { value: { read: string[] } }).value.read;

async function connected() {
  const { rig, google } = googleRig();
  await ensureCoreDocs(OWNER, rig.deps);
  expect((await connectGoogleVia(rig)).status).toBe(200);
  return { rig, google };
}

describe("S5: a connect whose state doesn't match touches nothing", () => {
  it("writes no row of any kind and leaves the pending authorization in place", async () => {
    const { rig, google } = googleRig();
    await ensureCoreDocs(OWNER, rig.deps);
    const start = await callRoute(rig, googleStartRoute, {});
    const before = JSON.stringify(await rowsOf(rig));
    const res = await callRoute(rig, googleConnectRoute, { requestId: testId("gc-x"), code: "4/x", state: "A".repeat(43) });
    expect(res).toMatchObject({ status: 409, body: { error: "STALE" } });
    expect(JSON.stringify(await rowsOf(rig))).toBe(before);
    expect(google.calls).toEqual([]);
    // The owner's own popup still connects afterwards.
    expect((await callRoute(rig, googleConnectRoute, { requestId: testId("gc-1"), code: "4/0AQSTgQ-test-code", state: stateOf(start.body.url) })).status).toBe(200);
  });
});

describe("S6: a disconnect wins over a connect in flight", () => {
  it("disconnect clears the pending authorization, so an open popup can't connect afterwards", async () => {
    const { rig, google } = googleRig();
    await ensureCoreDocs(OWNER, rig.deps);
    const start = await callRoute(rig, googleStartRoute, {});
    expect((await callRoute(rig, googleDisconnectRoute, { requestId: testId("gd-1") })).status).toBe(200);
    expect((await connector(rig, "gmail"))!.google!.pending).toBeNull();
    expect((await callRoute(rig, googleConnectRoute, { requestId: testId("gc-1"), code: "4/0AQSTgQ-test-code", state: stateOf(start.body.url) })).status).toBe(409);
    expect(google.count("exchangeCode")).toBe(0);
  });

  it("a disconnect that commits during the exchange: the connect saves nothing and revokes what it got", async () => {
    const { rig, google } = googleRig();
    await ensureCoreDocs(OWNER, rig.deps);
    let answered: unknown = null;
    google.during("exchangeCode", async () => {
      answered = await disconnectNow(rig, "gd-mid");
    });
    const res = await connectGoogleVia(rig);
    expect(answered).toMatchObject({ google: { mail: "off", calendar: "off" } });
    expect(res).toMatchObject({ status: 409, body: { error: "STALE" } });
    expect(google.calls.filter((c) => c.method === "revoke").map((c) => c.args[0])).toEqual([REFRESH_TOKEN]);
    for (const p of ["gmail", "calendar"] as const) {
      const c = await connector(rig, p);
      expect(c === null || (c.state === "disconnected" && c.google!.token === null)).toBe(true);
    }
    expect((await callRoute(rig, googleStatusRoute, undefined, STATUS)).body.google).toMatchObject({ mail: "off", calendar: "off" });
  });
});

describe("S7: a sealing key that changed still disconnects", () => {
  it("erases the token locally, records that Google was not told, and answers disconnected", async () => {
    const { rig, google } = await connected();
    rig.deps.env = { ...rig.deps.env, FRANKI_BANK_TOKEN_KEY: Buffer.alloc(32, 9).toString("base64") };
    const res = await callRoute(rig, googleDisconnectRoute, { requestId: testId("gd-1") });
    expect(res.status).toBe(200);
    expect(res.body.google).toMatchObject({ mail: "off", calendar: "off", email: null });
    expect(google.count("revoke")).toBe(0);
    for (const p of ["gmail", "calendar"] as const) expect((await connector(rig, p))!).toMatchObject({ state: "disconnected", google: { token: null, granted: false } });
    const row = (await ledger(rig)).find((l) => l.kind === "google" && l.payload.op === "disconnect");
    expect(row).toMatchObject({ state: "complete", payload: { outcome: "disconnectedUntold" } });
  });
});

describe("S8: no recorded answer keeps the account's address", () => {
  it("the connect answers the address live, and no ledger row holds it", async () => {
    const { rig } = googleRig();
    await ensureCoreDocs(OWNER, rig.deps);
    const res = await connectGoogleVia(rig);
    expect(res.body.google.email).toBe(ACCOUNT_EMAIL);
    expect(JSON.stringify(await ledger(rig))).not.toContain(ACCOUNT_EMAIL);
    expect((await callRoute(rig, googleDisconnectRoute, { requestId: testId("gd-1") })).status).toBe(200);
    expect(JSON.stringify(await ledger(rig))).not.toContain(ACCOUNT_EMAIL);
  });
});

describe("S3 and D5: a different Google account never reads the first one's rows", () => {
  const OTHER_ID = idTokenFor({ sub: "222222222222", email: "other@example.com" });

  it("after a disconnect, account B can't read account A's message, and B's own message of the same ID is a row of its own", async () => {
    const { rig, google } = await connected();
    google.messages.set("m1", gmailMessage("m1", { text: "A's private words" }));
    const a = readIds(await searchMail(await gctx(rig), Q))[0]!;
    expect((await callRoute(rig, googleDisconnectRoute, { requestId: testId("gd-1") })).status).toBe(200);
    google.tokens = { ...google.tokens, refreshToken: "1//0gSECONDaccount", idToken: OTHER_ID };
    expect((await connectGoogleVia(rig, 2)).status).toBe(200);
    const g = await gctx(rig);
    expect(await readableMessage(g, a)).toEqual({ ok: false, why: "notConnected" });
    google.messages.set("m1", gmailMessage("m1", { text: "B's own words" }));
    const b = readIds(await searchMail(g, Q))[0]!;
    expect(b).not.toBe(a);
    const rb = await readableMessage(g, b);
    expect(rb).toMatchObject({ ok: true, value: { body: "B's own words" } });
    const rows = await gmailRows(rig);
    expect((rows.find((r) => r.id === b)!.data as Evidence).revisionOf).toBeNull();
  });

  it("over an expired grant with no disconnect, account B still can't read A's rows", async () => {
    const { rig, google } = await connected();
    google.messages.set("m1", gmailMessage("m1", { text: "A's private words" }));
    const a = readIds(await searchMail(await gctx(rig), Q))[0]!;
    google.failNext("refresh", new GoogleCallError("invalidGrant", true));
    expect(await searchMail(await gctx(rig), Q)).toEqual({ ok: false, why: "expired" });
    google.tokens = { ...google.tokens, refreshToken: "1//0gSECONDaccount", idToken: OTHER_ID };
    expect((await connectGoogleVia(rig, 2)).status).toBe(200);
    expect(await readableMessage(await gctx(rig), a)).toEqual({ ok: false, why: "notConnected" });
  });

  it("the same account, connected again, reads its old rows", async () => {
    const { rig, google } = await connected();
    google.messages.set("m1", gmailMessage("m1", { text: "A's private words" }));
    const a = readIds(await searchMail(await gctx(rig), Q))[0]!;
    expect((await callRoute(rig, googleDisconnectRoute, { requestId: testId("gd-1") })).status).toBe(200);
    expect((await connectGoogleVia(rig, 2)).status).toBe(200);
    expect(await readableMessage(await gctx(rig), a)).toMatchObject({ ok: true, value: { body: "A's private words" } });
  });
});

describe("S4: a disconnect that commits mid-read stores and answers nothing", () => {
  it("mail", async () => {
    const { rig, google } = await connected();
    google.messages.set("m1", gmailMessage("m1"));
    google.during("getMessage", async () => void (await disconnectNow(rig, "gd-mid")));
    expect(await searchMail(await gctx(rig), Q)).toEqual({ ok: false, why: "notConnected" });
    expect(await gmailRows(rig)).toHaveLength(0);
  });

  it("calendar", async () => {
    const { rig, google } = await connected();
    google.events = { timeZone: "UTC", items: [calendarEvent("e1")] };
    google.during("listEvents", async () => void (await disconnectNow(rig, "gd-mid")));
    expect(await listEvents(await gctx(rig), { fromMs: Date.UTC(2026, 10, 16), toMs: Date.UTC(2026, 10, 17) })).toEqual({ ok: false, why: "notConnected" });
    expect((await rowsOf(rig)).filter((r) => r.path.includes("/evidence/"))).toHaveLength(0);
  });
});
