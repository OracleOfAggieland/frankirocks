// Brief 042 item 6 (question W-166): the hard-rule route's decisions get ledger rows, as IDs and codes, never words.
import { type CoreEpoch, type CoreRules, type Ledger, type RuleRowPayload, type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { listTenantRows } from "../seed/clear";
import { template } from "../testing/arb-rule-turns";
import { decisionAnswer } from "../testing/decisions";
import { commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { type TestRig, callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { paths } from "../store/paths";
import { runExtractJob } from "../worker/extract";
import { turnRoute } from "./turn";

const UID = "owner-1";
type SS = Awaited<ReturnType<typeof openTestSession>>["stamp"];

async function setup() {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("All right.")));
  const s = await openTestSession(rig);
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  return { rig, s, stamp: s.stamp };
}
const rulesOf = async (rig: TestRig) => (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
const post = (rig: TestRig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
const after = async (rig: TestRig, stamp: SS): Promise<SS> => {
  const epoch = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  const bundle = (await rig.store.get<{ bundleRev: number }>(UID, paths.core(UID, "bundle")))!.data;
  return { ...stamp, epoch: epoch.epoch, policyRev: epoch.policyRev, bundleRev: bundle.bundleRev, rulesRev: (await rulesOf(rig)).rulesRev };
};
const decide = (rig: TestRig, p: Parameters<typeof decisionAnswer>[0] = { hardRule: 0.9 }) => rig.openai.script("decisions.create", ok(decisionAnswer(p)));
const valid = (rig: TestRig, kind: Parameters<typeof template>[0], a = "shellfish" as const) => {
  const t = template(kind, a, "peanuts");
  rig.fastSlots.script((input) => ({ kind: "valid", out: { items: t.items(input.turn.eid), need: "none" }, ms: 50 }));
  return t.text;
};
const voice = (stamp: SS, n: number, text: string) => asrTurn(stamp, n, text, [{ itemId: `item_${n}`, commitSeq: n }]);
const rows = async (rig: TestRig): Promise<RuleRowPayload[]> =>
  (await listTenantRows(rig.store, UID)).filter((r) => r.path.includes("/ledger/") && (r.data as Ledger).kind === "rule").map((r) => (r.data as Extract<Ledger, { kind: "rule" }>).payload);
const label = (r: RuleRowPayload["rules"][number]) => `${r.anonymous ? "anyone" : r.subjectId}:${r.code}:${r.state}`;
const turnEid = async (rig: TestRig, sessionId: string, n: number) => (await rig.store.get<{ evidenceId: string }>(UID, paths.turn(UID, sessionId, testId(`turn-${n}`))))!.data.evidenceId;

/** No row carries the owner's words: no quote, and none of the given words (codes are not words). */
function expectNoWords(all: RuleRowPayload[], words: string[]) {
  const json = JSON.stringify(all).toLowerCase();
  expect(json).not.toContain("quote");
  for (const w of words) expect(json).not.toContain(w.toLowerCase());
}

describe("brief 042 item 6: the hard-rule route's decision rows", () => {
  it("1. a new active rule: one ruleWritten row citing the turn's Evidence and rulesRev after, with no words", async () => {
    const { rig, s, stamp } = await setup();
    decide(rig);
    const text = valid(rig, "self");
    await post(rig, voice(stamp, 1, text));
    const r = await rulesOf(rig);
    const all = await rows(rig);
    const written = all.filter((x) => x.decision === "ruleWritten");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ source: "turn", eid: await turnEid(rig, s.sessionId, 1), sessionId: s.sessionId, turnId: testId("turn-1"), rulesRev: r.rulesRev });
    expect(written[0]!.rules.map(label)).toEqual(["self:shellfish:active"]);
    expect(written[0]!.rules[0]!.proof).toMatchObject({ start: 0 });
    expectNoWords(all, ["allergic", "I'm"]);
  });

  it("2. a new pending rule names where it came from: a verdict, coverage, or the fallback", async () => {
    const a = await setup();
    decide(a.rig);
    await post(a.rig, voice(a.stamp, 1, valid(a.rig, "curry")));
    const pa = (await rows(a.rig)).filter((x) => x.decision === "pendingWritten");
    expect(pa.flatMap((x) => x.rules.map((r) => [label(r), r.origin]))).toEqual([["self:unresolved:pending", "verdict"]]);

    const b = await setup();
    decide(b.rig);
    b.rig.fastSlots.script({ kind: "transport", ms: 5 });
    await post(b.rig, voice(b.stamp, 1, "I'm allergic to shellfish."));
    const pb = (await rows(b.rig)).filter((x) => x.decision === "pendingWritten");
    expect(pb.flatMap((x) => x.rules.map((r) => [label(r), r.origin]))).toEqual([["anyone:shellfish:pending", "coverage"]]);

    const c = await setup();
    decide(c.rig);
    c.rig.fastSlots.script({ kind: "valid", out: { items: [], need: "none" }, ms: 50 });
    await post(c.rig, voice(c.stamp, 1, "I'm allergic to that stuff."));
    const pc = (await rows(c.rig)).filter((x) => x.decision === "pendingWritten");
    expect(pc.flatMap((x) => x.rules.map((r) => [label(r), r.origin]))).toEqual([["anyone:unresolved:pending", "fallback"]]);
  });

  it("3. a pending rule a new active rule answered: pendingResolved by rule, naming the rule", async () => {
    const { rig, s, stamp } = await setup();
    decide(rig);
    rig.fastSlots.script({ kind: "transport", ms: 5 });
    await post(rig, voice(stamp, 1, template("self", "shellfish", "peanuts").text));
    const anon = (await rulesOf(rig)).allergies.find((r) => r.anonymous && r.code === "shellfish")!;
    await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), { ask: { sessionId: s.sessionId, q: { kind: "asked", ruleId: anon.id, askedSeq: 1, attempts: 0 } } });
    decide(rig, { hardRule: 0.01 });
    await post(rig, voice(await after(rig, stamp), 2, valid(rig, "me")));
    const active = (await rulesOf(rig)).allergies.find((r) => r.state === "active")!;
    const resolved = (await rows(rig)).filter((x) => x.decision === "pendingResolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ by: "rule", eid: await turnEid(rig, s.sessionId, 2), rules: [{ ruleId: anon.id, answeredBy: active.id }] });
  });

  it("5 and 8. a certain denial against an active rule: ruleKept why denied, and the denial recorded with its code", async () => {
    const { rig, s, stamp } = await setup();
    decide(rig);
    await post(rig, typedTurn(stamp, 1, valid(rig, "self")));
    decide(rig);
    await post(rig, typedTurn(await after(rig, stamp), 2, valid(rig, "denial")));
    const eid = await turnEid(rig, s.sessionId, 2);
    const all = (await rows(rig)).filter((x) => x.eid === eid);
    const kept = all.filter((x) => x.decision === "ruleKept");
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ why: "denied", codes: ["shellfish"] });
    expect(kept[0]!.rules.map(label)).toEqual(["self:shellfish:active"]);
    expect(all.filter((x) => x.decision === "denialRecorded").map((x) => x.codes)).toEqual([["shellfish"]]);
  });

  it("4 and 6. a denial answering the asked rule removes it (by denial); a global denial with nothing on record adds the subject to noneConfirmed", async () => {
    const { rig, stamp } = await setup();
    decide(rig);
    await post(rig, typedTurn(stamp, 1, valid(rig, "global")));
    const r = await rulesOf(rig);
    expect(r.noneConfirmed).toEqual(["self"]);
    const none = (await rows(rig)).filter((x) => x.decision === "noneConfirmed");
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ subjects: [{ subjectId: "self", change: "added" }], cleared: false, rulesRev: r.rulesRev });
    // A new anonymous pending rule clears the list (2.6).
    decide(rig);
    rig.fastSlots.script({ kind: "transport", ms: 5 });
    await post(rig, typedTurn(await after(rig, stamp), 2, "I'm allergic to shellfish."));
    const cleared = (await rows(rig)).filter((x) => x.decision === "noneConfirmed" && x.cleared);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.subjects).toEqual([{ subjectId: "self", change: "removed" }]);
  });

  it("9. not an allergy: one notAllergy row, and nothing else", async () => {
    const { rig, stamp } = await setup();
    decide(rig, { hardRule: 0.3 });
    await post(rig, voice(stamp, 1, valid(rig, "mondays")));
    expect((await rows(rig)).map((x) => x.decision)).toEqual(["notAllergy"]);
  });

  it("a pasted allergy line: its filters are pendingWritten rows with origin pasted", async () => {
    const { rig, stamp } = await setup();
    await post(rig, { ...typedTurn(stamp, 1, "I'm allergic to peanuts, please no satay"), source: "pasted" });
    const p = (await rows(rig)).filter((x) => x.decision === "pendingWritten");
    expect(p.length).toBeGreaterThan(0);
    expect(p.every((x) => x.source === "pasted" && x.rules.every((r) => r.origin === "pasted"))).toBe(true);
    expect(p.flatMap((x) => x.rules.map((r) => r.code))).toContain("peanut");
  });

  it("7. the backstop's proposal: proposalWritten by the extraction worker, proposalInstalled on the next turn, both citing its Evidence", async () => {
    const rig = testRig();
    rig.openai.always("responses.create", ok(completed("All right.")));
    // The Session opens first: an open applies proposals too, and this test is about the turn's install.
    const s = await openTestSession(rig);
    const text = "I'm allergic to shellfish. Oh, and cashews too.";
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), text, rig.clock, rig.deps.hasher);
    const at = text.indexOf("cashews");
    const item = { ...factItem("statement", "new", "", [{ eid: turn.eid, fieldPath: "text" as const, start: at, end: at + 7, quote: "cashews" }]), subject: "self", kind: "rule", predicate: "allergy", value: { kind: "boolean", bool: true }, args: { allergenCode: "cashew" } };
    rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([item])))));
    expect(await settle(runExtractJob(UID, turn.jobId, rig.deps), rig.clock, rig.timers).then((r) => r.value)).toBe("complete");
    const written = (await rows(rig)).filter((x) => x.decision === "proposalWritten");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ source: "backstop", eid: turn.eid });
    expect(written[0]!.rules.map(label)).toEqual(["self:cashew:pending"]);

    rig.openai.script("decisions.create", ok(decisionAnswer({ hardRule: 0.01 })));
    await post(rig, voice(await after(rig, s.stamp), 1, "We watched a film about trains."));
    const installed = (await rows(rig)).filter((x) => x.decision === "proposalInstalled");
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({ eid: turn.eid, proposalId: written[0]!.proposalId });
    expect(installed[0]!.rules.map(label)).toEqual(["self:cashew:pending"]);
  });

  it("7. a repair's proposal: proposalWritten by the repair, citing the turn's Evidence", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const peanuts = "I can't have peanuts, I swell up.";
    const phrase = "I can't have peanuts";
    rig.openai.script("decisions.create", never(), ok(decisionAnswer({ hardRule: 0.9 })));
    rig.fastSlots.script((input) => ({ kind: "valid", out: { items: [{ kind: "allergy", subject: { entityId: null, mention: null, isSelf: true }, item: "peanuts", severity: "allergy", polarity: "affirmed", act: "direct", span: { eid: input.turn.eid, fieldPath: "text", start: 0, end: phrase.length, quote: phrase } }], need: "none" }, ms: 50 }));
    await post(rig, voice(s.stamp, 1, peanuts));
    await settle(rig.sched.runAll(), rig.clock, rig.timers);
    const written = (await rows(rig)).filter((x) => x.decision === "proposalWritten");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ source: "repair", eid: await turnEid(rig, s.sessionId, 1), turnId: testId("turn-1") });
    expect(written[0]!.rules.map((r) => r.code)).toEqual(["peanut"]);
  });

  it("a Superseding_Post's late route: its rows have source late and cite the turn's Evidence", async () => {
    const rig = testRig();
    const s = await openTestSession(rig);
    const first = await post(rig, asrTurn(s.stamp, 1, "", [{ itemId: "item_1", commitSeq: 1 }], "missing"));
    expect(first.body.status).toBe("hold");
    rig.openai.script("decisions.create", ok(decisionAnswer({ hardRule: 0.9 })));
    const text = valid(rig, "self");
    await post(rig, { ...asrTurn(s.stamp, 1, text, [{ itemId: "item_1", commitSeq: 1 }]), requestId: testId("req-1-late"), supersedesRequestId: testId("req-1") });
    const written = (await rows(rig)).filter((x) => x.decision === "ruleWritten");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ source: "late", eid: await turnEid(rig, s.sessionId, 1), rulesRev: (await rulesOf(rig)).rulesRev });
  });

  it("a retried commit writes each row once", async () => {
    const { rig, stamp } = await setup();
    decide(rig);
    const text = valid(rig, "self");
    const body = voice(stamp, 1, text);
    await post(rig, body);
    await post(rig, body);
    expect((await rows(rig)).filter((x) => x.decision === "ruleWritten")).toHaveLength(1);
  });
});
