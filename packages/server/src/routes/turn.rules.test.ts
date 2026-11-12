// Brief 018 task B6: the on-turn hardRule route on `/api/turn` (brief 012 design 3.0, 3.1's case table, 4, G17).
import { type CoreRules, type Session, ROUTE_NOTE_TEXT, TYPED_LINES, readRulesSection } from "@franki/core";
import { describe, expect, it } from "vitest";
import { never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { template } from "../testing/arb-rule-turns";
import { decisionAnswer } from "../testing/decisions";
import type { FakeSlotsScript } from "../testing/fake-fast-slots";
import { type TestRig, callRoute, failingStore, patchRecord, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnRoute } from "./turn";

const UID = "owner-1";
type SS = Awaited<ReturnType<typeof openTestSession>>["stamp"];

async function setup(call = true) {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("All right.")));
  const s = await openTestSession(rig);
  if (call) await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  return { rig, s, stamp: s.stamp };
}

const rulesOf = async (rig: TestRig) => (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
const post = (rig: TestRig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
const after = (stamp: SS, res: any): SS => ({ ...stamp, epoch: res.body.stamp.epoch, policyRev: res.body.stamp.policyRev, bundleRev: res.body.stamp.bundleRev, rulesRev: res.body.stamp.rulesRev });
const decide = (rig: TestRig, p: Parameters<typeof decisionAnswer>[0] = { hardRule: 0.9 }) => rig.openai.script("decisions.create", ok(decisionAnswer(p)));
const valid = (kind: Parameters<typeof template>[0], a = "shellfish" as const, b = "peanuts" as const): { text: string; slots: FakeSlotsScript } => {
  const t = template(kind, a, b);
  return { text: t.text, slots: (input) => ({ kind: "valid", out: { items: t.items(input.turn.eid), need: "none" }, ms: 50 }) };
};
const voice = (stamp: SS, n: number, text: string) => asrTurn(stamp, n, text, [{ itemId: `item_${n}`, commitSeq: n }]);
const active = (r: CoreRules) => r.allergies.filter((x) => x.state === "active").map((x) => `${x.subjectId}:${x.code}`);
const pending = (r: CoreRules) => r.allergies.filter((x) => x.state === "pending").map((x) => `${x.anonymous ? "anyone" : x.subjectId}:${x.code}`);
const texts = (res: any): string[] => (res.body.notes ?? []).map((n: { text: string }) => n.text);

describe("the hardRule route (B6)", () => {
  it("shellfish plus the brother: an active rule, a higher Deck whose Head lists it, a cut and the saved note", async () => {
    const { rig, stamp } = await setup();
    const t = valid("selfAndBrother");
    decide(rig);
    rig.fastSlots.script(t.slots);
    const res = await post(rig, voice(stamp, 1, t.text));
    const rules = await rulesOf(rig);
    expect(active(rules)).toEqual(["self:shellfish"]);
    expect(res.body).toMatchObject({ status: "ready", permit: { kind: "postCommitControl", scope: "reply" } });
    expect(res.body.deck.rulesRev).toBe(rules.rulesRev);
    expect(readRulesSection(res.body.deck.head.text)).toContainEqual({ subject: "You", code: "shellfish", state: "active" });
    expect(texts(res)).toContain(ROUTE_NOTE_TEXT.ruleSaved);
    expect(rules.handled.at(-1)!.entries).toEqual([expect.objectContaining({ route: "hardRule", outcome: "ruleWritten" })]);
    expect(rig.fastSlots.calls).toHaveLength(1);
    expect(rig.fastSlots.calls[0]!.deadlineMs).toBe(900);
  });

  it("two allergens, one returned: the returned rule, an anonymous pending rule for the other, and who it is for", async () => {
    const { rig, stamp } = await setup();
    const t = template("two", "shellfish", "peanuts");
    decide(rig);
    rig.fastSlots.script((input) => ({ kind: "valid", out: { items: t.items(input.turn.eid).slice(0, 1), need: "none" }, ms: 50 }));
    const res = await post(rig, voice(stamp, 1, t.text));
    const rules = await rulesOf(rig);
    expect(active(rules)).toEqual(["self:shellfish"]);
    expect(pending(rules)).toEqual(["anyone:peanut"]);
    expect(texts(res).join(" ")).toContain(ROUTE_NOTE_TEXT["ask.whoHas"]);
  });

  it("Mondays and 'so intolerant' write nothing and cut nothing", async () => {
    for (const kind of ["mondays", "intolerant"] as const) {
      const { rig, stamp } = await setup();
      const t = valid(kind);
      decide(rig, { hardRule: 0.3 });
      rig.fastSlots.script(t.slots);
      const res = await post(rig, voice(stamp, 1, t.text));
      const rules = await rulesOf(rig);
      expect(rules.allergies, kind).toEqual([]);
      expect(rules.rulesRev, kind).toBe(stamp.rulesRev);
      expect(rules.handled.at(-1)!.entries[0]!.outcome, kind).toBe("notAllergy");
      expect(res.body.status, kind).not.toBe("ready");
      expect(texts(res), kind).toEqual([]);
    }
  });

  it("the curry: pending for the owner, any food, and one question; the answer narrows it", async () => {
    const { rig, stamp } = await setup();
    const t = valid("curry");
    decide(rig);
    rig.fastSlots.script(t.slots);
    const res = await post(rig, voice(stamp, 1, t.text));
    const rules = await rulesOf(rig);
    expect(pending(rules)).toEqual(["self:unresolved"]);
    expect(texts(res).join(" ")).toContain(ROUTE_NOTE_TEXT["ask.whatItem"]);
    expect(rules.ask).toMatchObject({ q: { kind: "planned" } });
  });

  it("'Me.' answering who has it: the anonymous pending rule becomes the owner's active rule", async () => {
    const { rig, s, stamp } = await setup();
    // An earlier turn left an anonymous pending shellfish rule, and the question was asked (receipt, task B7).
    const t0 = template("self", "shellfish", "peanuts");
    decide(rig);
    rig.fastSlots.script({ kind: "transport", ms: 5 });
    const first = await post(rig, voice(stamp, 1, t0.text));
    const r0 = await rulesOf(rig);
    const anon = r0.allergies.find((r) => r.anonymous && r.code === "shellfish")!;
    expect(anon).toBeDefined();
    await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), { ask: { sessionId: s.sessionId, q: { kind: "asked", ruleId: anon.id, askedSeq: 1, attempts: 0 } } });
    const t = valid("me");
    decide(rig, { hardRule: 0.01 });
    rig.fastSlots.script(t.slots);
    await post(rig, voice(after(stamp, first), 2, t.text));
    const rules = await rulesOf(rig);
    expect(active(rules)).toEqual(["self:shellfish"]);
    expect(rules.allergies.some((r) => r.id === anon.id)).toBe(false);
    expect(rules.ask.q.kind).toBe("none");
  });

  it("a denial with a rule on record keeps it and cuts; with only pending rules a global denial clears them", async () => {
    const a = await setup();
    decide(a.rig);
    a.rig.fastSlots.script(valid("self").slots);
    const r1 = await post(a.rig, typedTurn(a.stamp, 1, "I'm allergic to shellfish."));
    decide(a.rig);
    a.rig.fastSlots.script(valid("denial").slots);
    const r2 = await post(a.rig, typedTurn(after(a.stamp, r1), 2, "I'm not allergic to shellfish."));
    expect(active(await rulesOf(a.rig))).toEqual(["self:shellfish"]);
    expect(r2.body).toMatchObject({ status: "ready" });
    expect(texts(r2).join(" ")).toContain(ROUTE_NOTE_TEXT.ruleKept);

    const b = await setup();
    decide(b.rig);
    b.rig.fastSlots.script(valid("curry").slots);
    const c1 = await post(b.rig, typedTurn(b.stamp, 1, template("curry", "kiwi", "kiwi").text));
    decide(b.rig);
    b.rig.fastSlots.script(valid("global").slots);
    await post(b.rig, typedTurn(after(b.stamp, c1), 2, "I don't have any allergies."));
    const rules = await rulesOf(b.rig);
    expect(pending(rules)).toEqual([]);
    expect(rules.noneConfirmed).toEqual(["self"]);
  });

  it("a guest's denial (speaker uncertain) relaxes nothing", async () => {
    const { rig, stamp } = await setup();
    decide(rig);
    rig.fastSlots.script(valid("curry").slots);
    const r1 = await post(rig, voice(stamp, 1, template("curry", "kiwi", "kiwi").text));
    decide(rig, { hardRule: 0.9, uncertainSpeaker: 0.4 });
    rig.fastSlots.script(valid("global").slots);
    await post(rig, voice(after(stamp, r1), 2, "I don't have any allergies."));
    const rules = await rulesOf(rig);
    expect(pending(rules)).toEqual(["self:unresolved"]);
    expect(rules.noneConfirmed).toEqual([]);
  });

  it("the same rule again: nothing written, no cut, the already-saved note", async () => {
    const { rig, stamp } = await setup();
    decide(rig);
    rig.fastSlots.script(valid("self").slots);
    const r1 = await post(rig, voice(stamp, 1, "I'm allergic to shellfish."));
    const rev = (await rulesOf(rig)).rulesRev;
    decide(rig);
    rig.fastSlots.script(valid("self").slots);
    const r2 = await post(rig, voice(after(stamp, r1), 2, "I'm allergic to shellfish."));
    expect((await rulesOf(rig)).rulesRev).toBe(rev);
    expect(texts(r2).join(" ")).toContain(ROUTE_NOTE_TEXT.ruleAlready);
    expect(r2.body.status).not.toBe("ready");
  });

  it("a timeout, a transport failure or an invalid answer: an anonymous pending rule for the alias, no saved note", async () => {
    for (const answer of [{ kind: "never" }, { kind: "transport", ms: 5 }, { kind: "invalid", reason: "shape", path: "$.items", ms: 40 }] as FakeSlotsScript[]) {
      const { rig, stamp } = await setup();
      decide(rig);
      rig.fastSlots.script(answer);
      const res = await post(rig, voice(stamp, 1, "I'm allergic to shellfish."));
      const rules = await rulesOf(rig);
      expect(active(rules)).toEqual([]);
      expect(pending(rules)).toEqual(["anyone:shellfish"]);
      expect(texts(res).join(" ")).not.toContain(ROUTE_NOTE_TEXT.ruleSaved);
      expect(texts(res).join(" ")).toContain(ROUTE_NOTE_TEXT["ask.whoHas"]);
    }
  });

  it("a failed parse with RX4: never an active rule, and the recovery reply carries no route note", async () => {
    const { rig, stamp } = await setup();
    rig.openai.script("decisions.create", never());
    rig.fastSlots.script(valid("self").slots);
    const res = await post(rig, voice(stamp, 1, "I'm allergic to shellfish."));
    const rules = await rulesOf(rig);
    expect(active(rules)).toEqual([]);
    expect(pending(rules)).toEqual(["anyone:shellfish"]);
    expect(res.body).toMatchObject({ status: "clarify", permit: { kind: "recoveryOnly" } });
    expect(texts(res).filter((x) => Object.values(ROUTE_NOTE_TEXT).some((t) => x.includes(t)))).toEqual([]);
  });

  it("a failed commit retried: one handled entry, one rule", async () => {
    const { rig, stamp } = await setup();
    let fail = true;
    rig.deps.store = failingStore(rig.store, () => {
      const f = fail;
      fail = false;
      return f;
    });
    decide(rig);
    decide(rig);
    rig.fastSlots.always(valid("self").slots);
    const body = voice(stamp, 1, "I'm allergic to shellfish.");
    const first = await post(rig, body);
    expect(first.status).not.toBe(200);
    expect(first.body?.notes ?? []).toEqual([]);
    const second = await post(rig, body);
    expect(second.status).toBe(200);
    const rules = await rulesOf(rig);
    expect(active(rules)).toEqual(["self:shellfish"]);
    expect(rules.handled.filter((h) => h.entries.some((e) => e.route === "hardRule"))).toHaveLength(1);
  });

  it("a duplicate post: the stored answer, no second FastSlots call, no second write", async () => {
    const { rig, stamp } = await setup();
    decide(rig);
    decide(rig);
    rig.fastSlots.always(valid("self").slots);
    const body = voice(stamp, 1, "I'm allergic to shellfish.");
    const a = await post(rig, body);
    const rev = (await rulesOf(rig)).rulesRev;
    const b = await post(rig, body);
    expect(b.body).toEqual(a.body);
    expect(rig.fastSlots.calls).toHaveLength(1);
    expect((await rulesOf(rig)).rulesRev).toBe(rev);
  });

  it("typed with no call open: exactly one Franki line, the reply written from the planned Head", async () => {
    const { rig, stamp } = await setup(false);
    decide(rig);
    rig.fastSlots.script(valid("self").slots);
    const res = await post(rig, typedTurn(stamp, 1, "I'm allergic to shellfish."));
    expect(texts(res)).toEqual(["All right."]);
    const asked = rig.openai.requestsTo("responses.create").map((r) => (r.body as { instructions: string }).instructions);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("- You: shellfish.");
    expect(asked[0]).toContain(ROUTE_NOTE_TEXT.ruleSaved);
    expect(active(await rulesOf(rig))).toEqual(["self:shellfish"]);
  });

  it("typed with no call open, the reply timing out: the closed line", async () => {
    const { rig, stamp } = await setup(false);
    rig.openai.always("responses.create", never());
    decide(rig);
    rig.fastSlots.script(valid("self").slots);
    const res = await post(rig, typedTurn(stamp, 1, "I'm allergic to shellfish."));
    expect(texts(res)).toEqual([TYPED_LINES.saved]);
  });

  it("typed with no call open, the committed plan differing from the planned one: the closed line for the committed plan", async () => {
    const { rig, stamp } = await setup(false);
    decide(rig);
    rig.fastSlots.script(valid("self").slots);
    const call = rig.openai.call.bind(rig.openai);
    rig.openai.call = async (endpoint, body) => {
      if (endpoint === "responses.create") {
        // Another writer saved the same rule between the plan and the transaction.
        const r = await rulesOf(rig);
        const id = rig.deps.hasher.id(["allergy", "self", "shellfish"]);
        const proof = { eid: id, fieldPath: "text" as const, start: 0, end: 9, quote: "shellfish" };
        await patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), { allergies: [...r.allergies, { id, subjectId: "self", code: "shellfish", state: "active", anonymous: false, proof, proofRev: 1, rootKeys: [], dependsOn: [] }] });
      }
      return call(endpoint, body);
    };
    const res = await post(rig, typedTurn(stamp, 1, "I'm allergic to shellfish."));
    expect(texts(res)).toEqual([TYPED_LINES.kept]);
  });
});

// Brief 018 task B10 (brief 012 G34, CQ 127): text a paste event supplied is T whatever its length.
describe("pasted text is T (B10)", () => {
  it("a pasted one-line allergy writes nothing in core/rules and opens no route", async () => {
    for (const call of [false, true]) {
      const { rig, stamp } = await setup(call);
      const before = await rulesOf(rig);
      const res = await post(rig, { ...typedTurn(stamp, 1, "I'm allergic to peanuts, please no satay"), source: "pasted" });
      expect(res.status, String(call)).toBe(200);
      expect(await rulesOf(rig), String(call)).toEqual(before);
      expect(rig.fastSlots.calls, String(call)).toHaveLength(0);
      expect(rig.openai.requestsTo("decisions.create"), String(call)).toHaveLength(0);
    }
  });
});
