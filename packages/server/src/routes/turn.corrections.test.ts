// Brief 025 task C3: the correction route on `/api/turn` (design 3.2). "No, her name is Mara, not Maya." marks the
// old name `wrong` and writes the new one before Franki answers; a target that moved, an uncertain target, a null
// replacement and the same correction said again.
import { type CoreBundle, type CoreRules, type FastItem, type Memory, ROUTE_NOTE_TEXT, type Session } from "@franki/core";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { type CorrectionSpec, UID, changedIds, correctionTurn, memoriesOf, seedPrior } from "../testing/arb-corrections";
import { decisionAnswer } from "../testing/decisions";
import { callRoute, patchRecord, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnRoute } from "./turn";

const spec = (o: Partial<CorrectionSpec>): CorrectionSpec => ({ kind: "rename", oldName: "Maya", newName: "Mara", selfName: "Alex", source: "typed", slots: "valid", uncertain: false, commitFails: false, extraction: "none", ...o });

async function setup(o: Partial<CorrectionSpec> = {}) {
  const rig = testRig();
  const seeded = await seedPrior(rig, o.oldName ?? "Maya");
  const s = await openTestSession(rig);
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  rig.openai.always("decisions.create", ok(decisionAnswer({ correct: 0.9 })));
  rig.openai.always("responses.create", ok(completed("All right.")));
  return { rig, seeded, s };
}

async function post(a: Awaited<ReturnType<typeof setup>>, text: string, items: (eid: string) => FastItem[]) {
  a.rig.fastSlots.script((input) => ({ kind: "valid", out: { items: items(input.turn.eid), need: "none" }, ms: 100 }));
  const before = await memoriesOf(a.rig.store);
  const res = await callRoute(a.rig, turnRoute, typedTurn(a.s.stamp, 1, text));
  const after = await memoriesOf(a.rig.store);
  const notes: string[] = (res.body?.notes ?? []).map((n: { text: string }) => n.text);
  const rules = (await a.rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
  const bundle = (await a.rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;
  return { res, before, after, changed: changedIds(before, after), notes, rules, bundle };
}

const statusOf = (m: Map<string, Memory>, f: (x: Memory) => boolean) => [...m.values()].filter(f).map((x) => [x.predicate, x.value.kind === "text" ? x.value.text : x.value.kind === "enum" ? x.value.code : x.value.kind, x.status]);

describe("the correction route (brief 025 C3)", () => {
  it("\"No, her name is Mara, not Maya.\": Maya is wrong, Mara is the name, the relation stays, and the reply already knows", async () => {
    const a = await setup();
    const t = correctionTurn(spec({}), a.seeded);
    const r = await post(a, t.text, (eid) => [t.item(eid)]);
    expect(r.res.status).toBe(200);
    const names = statusOf(r.after, (m) => m.predicate === "identity.name" && m.subjectId === a.seeded.sister);
    expect(names).toEqual(expect.arrayContaining([["identity.name", "Maya", "wrong"], ["identity.name", "Mara", "active"]]));
    expect(r.after.get(a.seeded.relId)).toEqual(r.before.get(a.seeded.relId));
    expect(r.notes).toContain(ROUTE_NOTE_TEXT.renamed);
    expect(r.bundle.head?.text).toContain("Mara");
    expect(r.res.body.stamp.bundleRev).toBeGreaterThan(a.s.stamp.bundleRev);
    const entries = r.rules.handled.flatMap((h) => h.entries);
    expect(entries.map((e) => [e.route, e.outcome])).toEqual([["correct", "renamed"]]);
  });

  it("a correction of the owner's own name marks Alec wrong, never history, and writes Alex", async () => {
    const a = await setup();
    const t = correctionTurn(spec({ kind: "value" }), a.seeded);
    const r = await post(a, t.text, (eid) => [t.item(eid)]);
    expect(r.after.get(a.seeded.selfNameId)!.status).toBe("wrong");
    expect(statusOf(r.after, (m) => m.predicate === "identity.name" && m.subjectId === "self" && m.status === "active")).toEqual([["identity.name", "Alex", "active"]]);
    expect(r.notes).toContain(ROUTE_NOTE_TEXT.corrected);
  });

  it("a target that moved between the snapshot and the transaction defers: nothing written, no note", async () => {
    const a = await setup();
    const t = correctionTurn(spec({}), a.seeded);
    a.rig.fastSlots.script((input) => ({ kind: "valid", out: { items: [t.item(input.turn.eid)], need: "none" }, ms: 100 }));
    // The relation row changes while FastSlots runs, after the route's snapshot.
    const slots = a.rig.fastSlots.slots.bind(a.rig.fastSlots);
    let before = new Map<string, Memory>();
    a.rig.fastSlots.slots = async (input, deadlineMs) => {
      const rel = (await a.rig.store.get<Memory>(UID, paths.memory(UID, a.seeded.relId)))!.data;
      await patchRecord<Memory>(a.rig.store, UID, paths.memory(UID, a.seeded.relId), { rev: rel.rev + 1 });
      before = await memoriesOf(a.rig.store);
      return slots(input, deadlineMs);
    };
    const r = await callRoute(a.rig, turnRoute, typedTurn(a.s.stamp, 1, t.text));
    expect(r.status).toBe(200);
    expect(a.rig.fastSlots.calls).toHaveLength(1);
    const after = await memoriesOf(a.rig.store);
    expect(changedIds(before, after)).toEqual([]);
    expect((r.body.notes ?? []).map((n: { text: string }) => n.text)).not.toContain(ROUTE_NOTE_TEXT.renamed);
    const rules = (await a.rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
    expect(rules.handled.flatMap((h) => h.entries).map((e) => [e.route, e.outcome])).toEqual([["correct", "deferred"]]);
  });

  it("two targets on different keys are no certain target: nothing written, no note", async () => {
    const a = await setup();
    const text = "No, her name is Mara, not Maya.";
    const r = await post(a, text, (eid) => [{ kind: "correction", targetIds: [a.seeded.relId, a.seeded.selfNameId], predicate: "identity.name", replacementValue: { kind: "text", text: "Mara" }, args: null, act: "direct", span: { eid, fieldPath: "text", start: 0, end: text.length - 1, quote: text.slice(0, -1) } }]);
    expect(r.changed).toEqual([]);
    expect(r.notes.filter((n) => n === ROUTE_NOTE_TEXT.renamed || n === ROUTE_NOTE_TEXT.corrected)).toEqual([]);
  });

  it("a null replacement retracts: the relation is wrong with no successor, and the note says so", async () => {
    const a = await setup();
    const t = correctionTurn(spec({ kind: "retract" }), a.seeded);
    const r = await post(a, t.text, (eid) => [t.item(eid)]);
    expect(r.after.get(a.seeded.relId)!.status).toBe("wrong");
    expect(r.changed).toEqual([a.seeded.relId]);
    expect(r.notes).toContain(ROUTE_NOTE_TEXT.retracted);
    expect(r.rules.handled.flatMap((h) => h.entries)[0]).toMatchObject({ route: "correct", outcome: "retracted", keys: [] });
  });

  it("the same correction said again writes nothing and claims nothing", async () => {
    const a = await setup();
    const t = correctionTurn(spec({ kind: "same" }), a.seeded);
    const r = await post(a, t.text, (eid) => [t.item(eid)]);
    expect(r.changed).toEqual([]);
    expect(r.notes.filter((n) => Object.values(ROUTE_NOTE_TEXT).includes(n))).toEqual([]);
    expect(r.rules.handled.flatMap((h) => h.entries).map((e) => e.outcome)).toEqual(["same"]);
  });

  it("an uncertain speaker's correction is left to extraction", async () => {
    const a = await setup();
    a.rig.openai.always("decisions.create", ok(decisionAnswer({ correct: 0.9, uncertainSpeaker: 0.4 })));
    const t = correctionTurn(spec({}), a.seeded);
    a.rig.fastSlots.script((input) => ({ kind: "valid", out: { items: [t.item(input.turn.eid)], need: "none" }, ms: 100 }));
    const before = await memoriesOf(a.rig.store);
    const res = await callRoute(a.rig, turnRoute, asrTurn(a.s.stamp, 1, t.text, [{ itemId: "item_1", commitSeq: 1 }]));
    expect(res.status).toBe(200);
    expect(changedIds(before, await memoriesOf(a.rig.store))).toEqual([]);
  });
});
