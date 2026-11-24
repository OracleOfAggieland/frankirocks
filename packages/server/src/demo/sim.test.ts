// Brief 054 part C2: the simulators' edges that the properties do not spell out. The event-ID mapping is pinned to
// the seed builder's own copy (build check 5) through `buildSeed`, since that copy is private to `seed/build.ts`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BankConfig } from "../bank/config";
import { BANK_ENV_VARS } from "../bank/config";
import { BankCallError } from "../bank/plaid";
import { ConfigError } from "../config/env";
import { createHasher } from "../crypto";
import type { GoogleConfig } from "../google/config";
import { mailContent } from "../google/mail";
import { GoogleCallError } from "../google/port";
import { SeedLoadError, buildSeed } from "../seed/build";
import { cloneWorldStart } from "../seed/clock";
import { type CalendarLine, type DemoProfile, type MailLine, type SeedFixture, at } from "../seed/fixture";
import { KISSES, KISSES_FIXTURE_ID } from "../seed/kisses";
import { BANK_TEST_KEY } from "../testing/fake-bank";
import { FAKE_HMAC_KEY } from "../testing/fakes";
import { demoBankConfig, demoGoogleConfig } from "./config";
import { parseGmailQuery } from "./gmail-query";
import { layoutOf } from "./layout";
import { refusingBank, refusingGoogle, routingBank, routingGoogle } from "./routing";
import { SIM_SYNC_PAGE, simTransactions, simulatedBank } from "./sim-bank";
import { simEventId, simMessages, simulatedGoogle } from "./sim-google";
import { simToken } from "./token";

const hasher = createHasher(FAKE_HMAC_KEY);
const ZONE = "America/Chicago";
const OPS = Date.UTC(2026, 10, 20, 18);
const WORLD = cloneWorldStart(OPS, ZONE);
const ID = "seed-test-sim-unit-000000000000000000000000";
const BANK_CFG = {} as BankConfig;
const GOOGLE_CFG = {} as GoogleConfig;

const PROFILE: DemoProfile = {
  displayName: "Test Person",
  bank: { itemId: "sim-item-1", institutionId: "sim-ins-1", institutionName: "Test Savings", accounts: [{ accountId: "acct-a", name: "Checking", mask: "1111", type: "depository", subtype: "checking" }] },
  google: { email: "test.person@example.test" },
};
const fixture = (lines: SeedFixture["lines"]): SeedFixture => ({ id: ID, origin: "authored", windowDays: 21, demo: PROFILE, lines });
const calendar = (id: string): CalendarLine => ({
  kind: "calendar",
  id,
  title: "Standup",
  organizerSelf: true,
  revisions: [{ at: at(-3, "08:00"), start: at(0, "10:00"), minutes: 30, status: "confirmed", selfResponse: "accepted" }],
});
const mail = (over: Partial<MailLine> = {}): MailLine => ({
  kind: "mail",
  id: "m1",
  at: at(-1, "09:00"),
  bulk: false,
  fromSelf: false,
  from: { name: "Pat Friend", address: "pat@friend.test" },
  to: ["test.person@example.test"],
  subject: "Lunch",
  body: "See you at noon.",
  thread: "lunch",
  ...over,
});
const tok = (kind: "bank" | "refresh" | "access", f: SeedFixture = fixture([])) => simToken({ kind, fixtureId: f.id, worldStart: WORLD, zone: ZONE });
const input = { uid: "owner-1", namespace: hasher.id(["ns", 1]), zone: ZONE, worldStart: WORLD, opsNow: OPS, core: { epoch: 1, policyRev: 1 }, hasher };

describe("simEventId is the seed builder's mapping", () => {
  it("collides at load exactly when the simulator's IDs collide", async () => {
    const idChar = fc.constantFrom(..."aZ09_-.~ /:é".split(""));
    const lineId = fc.array(idChar, { minLength: 1, maxLength: 6 }).map((a) => a.join(""));
    await fc.assert(
      fc.asyncProperty(lineId, lineId, async (a, b) => {
        fc.pre(a !== b);
        const loaded = await buildSeed(fixture([calendar(a), calendar(b)]), input).then(
          () => true,
          (e: unknown) => {
            expect(e).toBeInstanceOf(SeedLoadError);
            return false;
          },
        );
        expect(loaded).toBe(simEventId(a) !== simEventId(b));
      }),
      { numRuns: 300 },
    );
  });

  it("maps outside Google's alphabet to underscores", () => {
    expect(simEventId("cal.standup-1")).toBe("cal_standup-1");
    expect(simEventId("a b/c")).toBe("a_b_c");
  });
});

describe("the simulated bank", () => {
  const lines = Array.from({ length: 250 }, (_, i) => ({ kind: "bank" as const, id: `b${String(i).padStart(3, "0")}`, at: at(-(i % 20), "12:00"), merchant: "Moon Pizza", amountCents: 100 + i, category: "takeout" as const }));
  const f = fixture(lines);
  const sim = simulatedBank(new Map([[ID, f]]));

  it("pages a hundred at a time and adds nothing after the last page", async () => {
    const p1 = await sim.sync(BANK_CFG, tok("bank", f), null);
    expect(p1.added).toHaveLength(SIM_SYNC_PAGE);
    expect(p1).toMatchObject({ nextCursor: "sim:100", hasMore: true, updateStatus: "INITIAL_UPDATE_COMPLETE" });
    const p3 = await sim.sync(BANK_CFG, tok("bank", f), "sim:200");
    expect(p3.added).toHaveLength(50);
    expect(p3).toMatchObject({ nextCursor: "sim:250", hasMore: false, updateStatus: "HISTORICAL_UPDATE_COMPLETE" });
    const after = await sim.sync(BANK_CFG, tok("bank", f), "sim:250");
    expect(after).toMatchObject({ added: [], hasMore: false, nextCursor: "sim:250" });
    expect(after.accounts).toEqual([{ account_id: "acct-a", name: "Checking", mask: "1111", type: "depository", subtype: "checking" }]);
  });

  it("orders by purchase instant, then line ID", () => {
    const t = simTransactions(layoutOf({ kind: "bank", fixtureId: ID, worldStart: WORLD, zone: ZONE }, new Map([[ID, f]]))!);
    for (let i = 1; i < t.length; i++) {
      const a = Date.parse(t[i - 1]!.authorized_datetime!);
      const b = Date.parse(t[i]!.authorized_datetime!);
      expect(a < b || (a === b && t[i - 1]!.transaction_id < t[i]!.transaction_id)).toBe(true);
    }
  });

  it("answers the profile's institution and accounts", async () => {
    expect(await sim.accounts(BANK_CFG, tok("bank", f))).toEqual({ itemId: "sim-item-1", institutionId: "sim-ins-1", institutionName: "Test Savings", accounts: [{ account_id: "acct-a", name: "Checking", mask: "1111", type: "depository", subtype: "checking" }] });
  });

  it("refuses a bad cursor, another kind of token, an unknown fixture, and the token-less calls", async () => {
    const definite = (p: Promise<unknown>) => expect(p).rejects.toSatisfy((e: unknown) => e instanceof BankCallError && e.definite);
    for (const c of ["sim:251", "sim:-1", "sim:", "sim:1234567", "cursor-1", ""]) await definite(sim.sync(BANK_CFG, tok("bank", f), c));
    await definite(sim.sync(BANK_CFG, tok("refresh", f), null));
    await definite(sim.accounts(BANK_CFG, tok("access", f)));
    await definite(sim.sync(BANK_CFG, simToken({ kind: "bank", fixtureId: "x".repeat(43), worldStart: WORLD, zone: ZONE }), null));
    await definite(simulatedBank(new Map([[ID, { ...f, demo: undefined }]])).sync(BANK_CFG, tok("bank", f), null));
    await definite(sim.sync(BANK_CFG, "access-sandbox-123", null));
    await definite(sim.linkToken(BANK_CFG, "owner"));
    await definite(sim.exchange(BANK_CFG, "public-sandbox-1"));
    await expect(sim.remove(BANK_CFG, tok("bank", f))).resolves.toBeUndefined();
  });

  it("serves the registered demo fixture by default", async () => {
    const p = await simulatedBank().sync(BANK_CFG, tok("bank", KISSES), null);
    expect(p.added.length).toBe(KISSES.lines.filter((l) => l.kind === "bank").length);
    expect(KISSES.id).toBe(KISSES_FIXTURE_ID);
  });
});

describe("the simulated Google", () => {
  const f = fixture([
    mail(),
    mail({ id: "m2", at: at(-1, "10:00"), inReplyTo: "m1", thread: "lunch", dmarc: "fail", unread: true }),
    mail({ id: "m3", at: at(-2, "10:00"), fromSelf: true, from: { name: "Test Person", address: "test.person@example.test" }, to: ["pat@friend.test"], thread: "other" }),
    mail({ id: "m4", at: at(-2, "11:00"), bulk: true, from: { name: "Rocket, News", address: "news@rocket.example" }, thread: "news", dmarc: "none" }),
    calendar("cal.1"),
    { ...calendar("cal2"), revisions: [...calendar("x").revisions, { at: at(-1, "08:00"), start: at(0, "11:00"), minutes: 30, status: "cancelled", selfResponse: "accepted" }] },
  ]);
  const sim = simulatedGoogle(new Map([[ID, f]]));
  const layout = layoutOf({ kind: "access", fixtureId: ID, worldStart: WORLD, zone: ZONE }, new Map([[ID, f]]))!;

  it("threads replies and marks own, bulk and unread mail as Gmail does", () => {
    const byLine = new Map(simMessages(layout).map((m) => [m.line.id, m]));
    expect(byLine.get("m1")!.id).toBe("m0000");
    expect(byLine.get("m2")!.threadId).toBe("t0000");
    expect(byLine.get("m3")!.labelIds).toEqual(["SENT"]);
    expect(byLine.get("m2")!.labelIds).toEqual(["INBOX", "UNREAD"]);
    expect(byLine.get("m4")!.labelIds).toEqual(["INBOX", "CATEGORY_UPDATES"]);
    const headers = (id: string) => new Map((byLine.get(id)!.message.payload as { headers: { name: string; value: string }[] }).headers.map((h) => [h.name, h.value]));
    expect(headers("m2").get("In-Reply-To")).toBe(headers("m1").get("Message-ID"));
    expect(headers("m4").get("List-Id")).toBe("<list.rocket.example>");
    expect(headers("m4").get("From")).toBe('"Rocket, News" <news@rocket.example>');
    expect(headers("m3").has("Authentication-Results")).toBe(false);
    const read = (id: string) => mailContent(byLine.get(id)!.message)!;
    expect([read("m1").senderAuth, read("m2").senderAuth, read("m4").senderAuth]).toEqual(["aligned", "failed", "unknown"]);
    expect(read("m4")).toMatchObject({ bulk: true, senderName: "Rocket, News", senderAddress: "news@rocket.example" });
  });

  it("lists only the last revision and leaves a cancelled event out", async () => {
    const page = await sim.listEvents(tok("access", f), { timeMin: "2000-01-01T00:00:00Z", timeMax: "2100-01-01T00:00:00Z", max: 10 });
    expect(page.items.map((i) => (i as { id: string }).id)).toEqual(["cal_1"]);
    expect(page).toMatchObject({ timeZone: ZONE, nextPageToken: null });
  });

  it("refuses what it does not answer, and never with a live-shaped answer", async () => {
    const refused = (p: Promise<unknown>) => expect(p).rejects.toSatisfy((e: unknown) => e instanceof GoogleCallError && e.problem === "refused" && e.definite);
    await refused(sim.exchangeCode(GOOGLE_CFG, { code: "c", verifier: "v".repeat(43), redirectUri: "http://localhost/google/callback" }));
    await refused(sim.refresh(GOOGLE_CFG, tok("access", f)));
    await refused(sim.listMessages(tok("refresh", f), "in:sent", 1));
    await refused(sim.listMessages(tok("access", f), "subject:lunch", 1));
    await refused(sim.listEvents(tok("access", f), { timeMin: "2026-01-01", timeMax: "2026-02-01T00:00:00Z", max: 1 }));
    await refused(sim.listEvents(tok("access", f), { timeMin: "2026-01-01T00:00:00Z", timeMax: "2026-02-01T00:00:00Z", max: 1, pageToken: "abc" }));
    await refused(sim.revoke(tok("bank", f)));
    await expect(sim.revoke(tok("refresh", f))).resolves.toBeUndefined();
    await expect(sim.getMessage(tok("access", f), "m0099")).rejects.toSatisfy((e: unknown) => e instanceof GoogleCallError && e.problem === "notFound");
  });

  it("pages events by the integer in the page token", async () => {
    const many = fixture(Array.from({ length: 5 }, (_, i) => calendar(`c${i}`)));
    const s = simulatedGoogle(new Map([[ID, many]]));
    const w = { timeMin: "2000-01-01T00:00:00Z", timeMax: "2100-01-01T00:00:00Z", max: 2 };
    const p1 = await s.listEvents(tok("access", many), w);
    const p2 = await s.listEvents(tok("access", many), { ...w, pageToken: p1.nextPageToken! });
    const p3 = await s.listEvents(tok("access", many), { ...w, pageToken: p2.nextPageToken! });
    expect([p1.items.length, p2.items.length, p3.items.length, p3.nextPageToken]).toEqual([2, 2, 1, null]);
  });
});

describe("the Gmail query parser", () => {
  it("reads every form the product writes", () => {
    expect(parseGmailQuery('from:"pat friend" "lunch" "see you" after:10 before:20 is:unread -in:spam -in:trash -category:promotions -category:social')).toEqual([
      { neg: false, op: "from", value: "pat friend" },
      { neg: false, op: "word", value: "lunch" },
      { neg: false, op: "word", value: "see you" },
      { neg: false, op: "after", seconds: 10 },
      { neg: false, op: "before", seconds: 20 },
      { neg: false, op: "is", value: "unread" },
      { neg: true, op: "in", value: "spam" },
      { neg: true, op: "in", value: "trash" },
      { neg: true, op: "category", value: "promotions" },
      { neg: true, op: "category", value: "social" },
    ]);
    expect(parseGmailQuery("in:sent to:pat@friend.test")).toEqual([
      { neg: false, op: "in", value: "sent" },
      { neg: false, op: "to", value: "pat@friend.test" },
    ]);
  });

  it("refuses anything else", () => {
    for (const q of ["", " ", "in:sent  to:a@b.c", "in:sent ", '"unclosed', 'from:pat', "to:not-an-address", "in:inbox", "-is:unread", "after:x"]) expect(parseGmailQuery(q)).toBeNull();
  });
});

describe("routing and the demo-only settings", () => {
  it("refuses every call on the refusing live halves", async () => {
    for (const p of [refusingBank.linkToken(BANK_CFG, "u"), refusingBank.exchange(BANK_CFG, "p"), refusingBank.accounts(BANK_CFG, "t"), refusingBank.sync(BANK_CFG, "t", null), refusingBank.remove(BANK_CFG, "t")]) {
      await expect(p).rejects.toSatisfy((e: unknown) => e instanceof BankCallError && e.definite);
    }
    for (const p of [refusingGoogle.refresh(GOOGLE_CFG, "t"), refusingGoogle.revoke("t"), refusingGoogle.listMessages("t", "q", 1), refusingGoogle.getMessage("t", "m"), refusingGoogle.listEvents("t", { timeMin: "", timeMax: "", max: 1 })]) {
      await expect(p).rejects.toSatisfy((e: unknown) => e instanceof GoogleCallError && e.problem === "refused" && e.definite);
    }
  });

  it("routes a demo visit's bank and Google to the simulators even when the live halves refuse", async () => {
    const f = fixture([{ kind: "bank", id: "b1", at: at(-1, "12:00"), merchant: "Moon Pizza", amountCents: 1234, category: "takeout" }, mail()]);
    const fixtures = new Map([[ID, f]]);
    const bank = routingBank(refusingBank, simulatedBank(fixtures));
    expect((await bank.sync(BANK_CFG, tok("bank", f), null)).added.map((t) => t.amount)).toEqual([12.34]);
    const google = routingGoogle(refusingGoogle, simulatedGoogle(fixtures));
    const { accessToken } = await google.refresh(GOOGLE_CFG, tok("refresh", f));
    expect(await google.listMessages(accessToken, "-in:spam", 5)).toEqual([{ id: "m0000", threadId: "t0000" }]);
  });

  it("reads the token key for real and nothing else", () => {
    const env = { [BANK_ENV_VARS.tokenKey]: BANK_TEST_KEY };
    expect(demoBankConfig(env)).toMatchObject({ clientId: "demo", secret: "demo", environment: "sandbox" });
    expect(demoGoogleConfig(env).tokenKeys).toEqual(demoBankConfig(env).tokenKeys);
    expect(() => demoBankConfig({})).toThrow(ConfigError);
    expect(() => demoGoogleConfig({})).toThrow(ConfigError);
  });
});
