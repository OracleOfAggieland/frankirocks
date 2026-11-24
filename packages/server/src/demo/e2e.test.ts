/**
 * Brief 054 part C3, the end-to-end demo test (design "Testing strategy", "Rigs"). An anonymous visitor presses
 * Kiroween Demo on a deployment with no Plaid or Google settings: the reset clones a demo fixture and installs its
 * three connectors; the sheets say simulated; `read_money` answers "rocket fuel this month" from the simulated bank
 * through the real pull; and the mail and calendar errands run over the simulated Google with the scripted planner,
 * on the visit's world clock. Every figure is checked against the fixture's own lines, so the same test holds for the
 * Kisses persona once its lines land (until then its stub has none, and only the parts with lines run).
 */
import { type Errand, type Stamp, codeKind, groupMatches, groupOf, msFromTs, tokenize } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { readMoney } from "../bank/money-read";
import { ownerClock, readCoreDocs } from "../core-docs";
import { bankStatusRoute } from "../bank/routes";
import { errandIdOf } from "../errands/records";
import { googleStatusRoute } from "../google/routes";
import { openRoute } from "../routes/open";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { localDate, relInstant } from "../seed/clock";
import { type BankLine, type CalendarLine, type MailLine, type SeedFixture, bankCodeOf } from "../seed/fixture";
import { paths } from "../store/paths";
import { KISSES_FIXTURE_ID } from "../seed/kisses";
import { ANON, DEMO_FIXTURES, VISITOR, demoRig, resetDemo } from "../testing/demo-fixture";
import { scriptPlanner } from "../testing/errand-agent";
import { callRoute, runScheduled, settle } from "../testing/fakes";
import { readerSays } from "../testing/google-errand";
import { ownerTurnRecord } from "../testing/money-rig";
import { asrTurn, currentVisit } from "../testing/session-fixtures";

const ZONE = "America/Chicago";
const lines = <K extends SeedFixture["lines"][number]["kind"]>(f: SeedFixture, kind: K) => f.lines.filter((l) => l.kind === kind) as Extract<SeedFixture["lines"][number], { kind: K }>[];

/** The money the fixture's own lines give for "this month" at one merchant (spent, money back), on the visit's clock. */
function oracle(f: SeedFixture, worldStart: number, nowMs: number, merchant: string): { spent: number; back: number } {
  const friday = localDate(worldStart, ZONE);
  const now = localDate(nowMs, ZONE);
  const from = `${now.slice(0, 7)}-01`;
  const terms = tokenize(merchant).filter((t) => t.length >= 2);
  let spent = 0;
  let back = 0;
  for (const l of lines(f, "bank") as BankLine[]) {
    const code = bankCodeOf(l);
    if (codeKind(code) !== "ordinary" || !groupMatches(null, groupOf(code)) || l.pending === true) continue;
    const words = new Set(tokenize(l.merchant));
    if (!terms.every((t) => words.has(t))) continue;
    const day = localDate(relInstant(friday, l.at, ZONE), ZONE);
    if (day < from || day > now) continue;
    if (l.amountCents > 0) spent += l.amountCents;
    else back -= l.amountCents;
  }
  return { spent, back };
}

async function demoVisit(f: SeedFixture) {
  const { rig, live } = demoRig();
  const reset = await resetDemo(rig, f.id, 1, ZONE);
  expect(reset.status).toBe(200);
  const worldStart = msFromTs(reset.body.worldClock);
  const open = await callRoute(rig, openRoute, { requestId: testId("e2e-open"), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: await currentVisit(rig, VISITOR) }, { token: ANON });
  expect(open.status).toBe(200);
  const s0 = { sessionId: open.body.sessionId as string, epoch: open.body.deck.epoch, policyRev: open.body.deck.policyRev, bundleRev: open.body.deck.bundleRev, rulesRev: open.body.deck.rulesRev, generation: 1 };
  let seq = 0;
  const say = async (text: string): Promise<Stamp> => {
    seq++;
    const res = await callRoute(rig, turnRoute, { ...asrTurn(s0, seq, text, [{ itemId: `e2e-${seq}`, commitSeq: seq }], "final", `e2e-${seq}`), judge: "O" }, { token: ANON });
    expect(res.status).toBe(200);
    return res.body.stamp as Stamp;
  };
  const tool = (stamp: Stamp, name: string, args: unknown) => callRoute(rig, toolRoute, { requestId: testId(`e2e-tool-${seq}`), stamp, callId: `tool${seq}`, tool: { name, args } }, { token: ANON });
  const errandOf = async (stamp: Stamp) => (await rig.store.get<Errand>(VISITOR, paths.errand(VISITOR, errandIdOf(rig.deps.hasher, s0.sessionId, stamp.turnId))))?.data ?? null;
  return { rig, live, worldStart, say, tool, errandOf };
}

describe.each(DEMO_FIXTURES.map((f) => [f.id, f] as const))("a demo visit end to end (%s)", (_id, f) => {
  it("arrives with a simulated bank, Gmail and Calendar, and no way to connect", async () => {
    const { rig, live } = await demoVisit(f);
    const bank = await callRoute(rig, bankStatusRoute, undefined, { token: ANON, method: "GET" });
    expect(bank.status).toBe(200);
    expect(bank.body).toMatchObject({ canConnect: false, simulated: true });
    expect(bank.body.banks).toHaveLength(1);
    expect(bank.body.banks[0]).toMatchObject({ institutionName: f.demo!.bank.institutionName, state: "connected", importing: false });
    expect(bank.body.banks[0].accounts.map((a: { name: string }) => a.name)).toEqual(f.demo!.bank.accounts.map((a) => a.name));
    const google = await callRoute(rig, googleStatusRoute, undefined, { token: ANON, method: "GET" });
    expect(google.status).toBe(200);
    expect(google.body).toMatchObject({ simulated: true, google: { email: f.demo!.google.email, mail: "connected", calendar: "connected" } });
    // A signed-in user on the same deployment (no Plaid or Google settings) is answered CONFIG, as before.
    expect((await callRoute(rig, bankStatusRoute, undefined, { token: "token:owner-1", method: "GET" })).body).toStrictEqual({ error: "CONFIG", retryAfterMs: 0 });
    expect((await callRoute(rig, googleStatusRoute, undefined, { token: "token:owner-1", method: "GET" })).body).toStrictEqual({ error: "CONFIG", retryAfterMs: 0 });
    expect(live.calls).toEqual([]);
  });

  const fuel = (lines(f, "bank") as BankLine[]).find((l) => /fuel/i.test(l.merchant));
  it.skipIf(fuel === undefined)("answers rocket fuel this month from the simulated bank, on the visit's clock, to the cent", async () => {
    const { rig, live, worldStart, say, tool } = await demoVisit(f);
    // The merchant must be in the owner's own words (the read checks it), as "rocket fuel" is in the brief's question.
    const words = `How much did I spend at ${fuel!.merchant} this month?`;
    const args = { period: "this_month", group: null, merchant: fuel!.merchant };
    const stamp = await say(words);
    const res = await tool(stamp, "read_money", args);
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ name: "read_money", state: "answered" });

    // The visit's own clock, as every read takes it (`ownerClock`), not the rig's.
    const core = await readCoreDocs({ get: (p) => rig.store.get(VISITOR, p) }, VISITOR);
    const visitNow = ownerClock(core.state.data, rig.deps.clock).worldClock.now;
    const want = oracle(f, worldStart, visitNow, fuel!.merchant);
    expect(want.spent).toBeGreaterThan(0);
    // The same read, with the token's flag and with none (the connectors decide), gives the oracle's figures.
    for (const anonymous of [true, undefined]) {
      const ctx = { uid: VISITOR, deps: rig.deps, schedule: rig.sched.schedule, ...(anonymous === undefined ? {} : { anonymous }) };
      const work = readMoney(ctx, { turn: ownerTurnRecord(words), args: args as never, generation: 1, deadlineAt: rig.clock.read().opsClock.now + 4_200, noteId: (n) => testId(`e2e-note-${n}`) as never });
      const out = (await settle(work, rig.clock, rig.timers)).value;
      expect(out.facts?.kind).toBe("answered");
      if (out.facts?.kind !== "answered") return;
      expect(out.facts.parts.reduce((s, p) => s + p.spent.cents, 0)).toBe(want.spent);
      expect(out.facts.parts.reduce((s, p) => s + p.moneyBack.cents, 0)).toBe(want.back);
    }
    expect(live.calls).toEqual([]);
  });

  // The brief's own sentence, as a visitor would say it: the model may pass the merchant words or the spending group.
  it.skipIf(f.id !== KISSES_FIXTURE_ID)("answers \"How much did I spend on rocket fuel this month?\" by merchant words and by group", async () => {
    const { rig, live, worldStart } = await demoVisit(f);
    const words = "How much did I spend on rocket fuel this month?";
    const core = await readCoreDocs({ get: (p) => rig.store.get(VISITOR, p) }, VISITOR);
    const want = oracle(f, worldStart, ownerClock(core.state.data, rig.deps.clock).worldClock.now, "rocket fuel");
    expect(want.spent).toBeGreaterThan(0);
    for (const args of [{ period: "this_month", group: null, merchant: "rocket fuel" }, { period: "this_month", group: "transportation", merchant: null }]) {
      const ctx = { uid: VISITOR, deps: rig.deps, schedule: rig.sched.schedule, anonymous: true };
      const work = readMoney(ctx, { turn: ownerTurnRecord(words), args: args as never, generation: 1, deadlineAt: rig.clock.read().opsClock.now + 4_200, noteId: (n) => testId(`e2e-say-${n}`) as never });
      const out = (await settle(work, rig.clock, rig.timers)).value;
      expect(out.facts?.kind).toBe("answered");
      if (out.facts?.kind !== "answered") return;
      expect(out.facts.parts.reduce((s, p) => s + p.spent.cents, 0)).toBe(want.spent);
    }
    expect(live.calls).toEqual([]);
  });

  const mission = (lines(f, "mail") as MailLine[]).find((l) => !l.fromSelf && /mission control/i.test(l.from.name));
  it.skipIf(mission === undefined)("finds the mail from mission control through the mail errand", async () => {
    const { rig, live, say, tool, errandOf } = await demoVisit(f);
    scriptPlanner(
      rig,
      [
        { call: "search_mail", args: { from: "mission control", words: [], when: null, unread: false } },
        { call: "read_mail", args: { ref: "r1" } },
        { outcome: "answered", lines: [{ text: "Mission control wrote about it.", refs: ["r1"] }] },
      ],
      readerSays("Mission control wrote about it."),
    );
    const stamp = await say("Check my mail for anything from mission control.");
    expect((await tool(stamp, "start_errand", { about: ["mail"] })).body.result.state).toBe("started");
    await runScheduled(rig);
    const e = await errandOf(stamp);
    expect(e?.status).toMatch(/ready|delivered|cardOnly/);
    expect(e!.lines).toHaveLength(1);
    const first = e!.reads[0]!;
    // Newest first: the search's first hit is the newest message from that sender.
    const fromMission = (lines(f, "mail") as MailLine[]).filter((l) => !l.fromSelf && /mission control/i.test(`${l.from.name} ${l.from.address}`));
    expect(fromMission.map((l) => l.subject)).toContain(first.source.kind === "mail" ? first.source.subject : null);
    expect(first.sender?.address).toBe(mission!.from.address.toLowerCase());
    expect(live.calls).toEqual([]);
  });

  const friday = (l: CalendarLine, worldStart: number) => {
    const last = l.revisions.at(-1)!;
    const fri = localDate(worldStart, ZONE);
    return last.status !== "cancelled" && localDate(relInstant(fri, last.start, ZONE), ZONE) === fri;
  };
  it.skipIf((lines(f, "calendar") as CalendarLine[]).length === 0)("reads today's calendar as the visit's Friday, not the real day", async () => {
    const { rig, live, worldStart, say, tool, errandOf } = await demoVisit(f);
    const today = (lines(f, "calendar") as CalendarLine[]).filter((l) => friday(l, worldStart));
    expect(today.length).toBeGreaterThan(0);
    scriptPlanner(rig, [
      { call: "list_events", args: { when: "today", part: null } },
      { outcome: "answered", lines: [{ text: "You have something on today.", refs: ["r1"] }] },
    ]);
    const stamp = await say("What's on my calendar today?");
    expect((await tool(stamp, "start_errand", { about: ["calendar"] })).body.result.state).toBe("started");
    await runScheduled(rig);
    const e = await errandOf(stamp);
    expect(e!.lines).toHaveLength(1);
    const titles = e!.reads.map((r) => (r.source.kind === "event" ? r.source.title : null));
    expect(titles.sort()).toEqual(today.map((l) => l.title).sort());
    // The real day (the ops clock) is days after the visit's Friday, so it would have found other events or none.
    expect(localDate(rig.clock.read().opsClock.now, ZONE)).not.toBe(localDate(worldStart, ZONE));
    expect(live.calls).toEqual([]);
  });
});
