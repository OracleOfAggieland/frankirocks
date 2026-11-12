// Brief 025 task D2: the transition route on `/api/turn` (design 3.3). "My dad passed away last night." writes the
// truth order in the turn's transaction, held and on the fast path; "I might leave my job" writes nothing; a dated
// change after now defers; a move, the owner's job change with one and two roles, a breakup and a reunion.
import { type CoreBundle, type CoreRules, type FastItem, type Job, type Memory, ROUTE_NOTE_TEXT, type Session, type Value, idParts, keyOf, mentionEid, rootKey, turnTextSlice } from "@franki/core";
import { sampleMemory, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { recordFastO } from "../admission/seam";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { UID, changedIds, memoriesOf } from "../testing/arb-corrections";
import { decisionAnswer } from "../testing/decisions";
import { commitUserTurnForTest } from "../testing/extract-fixtures";
import { type TestRig, callRoute, patchRecord, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnRoute } from "./turn";

type Pred = Parameters<typeof keyOf>[1];
interface RowIn {
  subjectId: string;
  predicate: Pred;
  value: Value;
  args: Record<string, unknown>;
  status?: Memory["status"];
  line: string;
  entityIds?: string[];
}

const say = (text: string) => ({ text, entityRefs: [], timeFields: [] });

/** An earlier turn (its job done) and the Memories extraction wrote from it. Returns their IDs in order. */
async function seed(rig: TestRig, text: string, rows: RowIn[]): Promise<string[]> {
  const H = rig.deps.hasher;
  const prior = await commitUserTurnForTest(rig.store, UID, testId("prior"), text, rig.clock, H);
  await patchRecord<Job>(rig.store, UID, paths.job(UID, prior.jobId), { status: "complete" } as Partial<Job>);
  const slice = turnTextSlice(prior.eid, prior.text, "U", H);
  const at = "2026-11-03T12:00:00.000Z";
  const ids = rows.map((_, i) => H.id(idParts.memory(prior.jobId, i)));
  await rig.store.transaction(UID, async (tx) => {
    rows.forEach((r, i) => {
      const k = keyOf(r.subjectId, r.predicate, r.args, r.value, H);
      tx.create(
        paths.memory(UID, ids[i]!),
        sampleMemory({
          uid: UID,
          logicalId: ids[i]!,
          rootSlices: [slice],
          rootKeys: [rootKey(slice, H)],
          packetEids: [prior.eid],
          dependsOn: [`e:${prior.eid}`],
          supportingIds: [{ type: "evidence", id: prior.eid, rev: 1 }],
          subjectId: r.subjectId,
          predicate: r.predicate,
          kind: r.predicate === "care" ? "care" : "fact",
          value: r.value,
          args: r.args,
          scopeId: k.scopeId,
          key: k.key,
          status: r.status ?? "active",
          validTo: r.status === "history" ? at : null,
          entityIds: r.entityIds ?? (r.subjectId === "self" ? [] : [r.subjectId]),
          sayAs: say(r.line),
          assertedAt: at,
          validFrom: at,
          validFromKey: at,
        } as Partial<Memory>),
      );
    });
  });
  return ids;
}

async function setup() {
  const rig = testRig();
  const s = await openTestSession(rig);
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  rig.openai.always("decisions.create", ok(decisionAnswer({ transition: 0.9 })));
  rig.openai.always("responses.create", ok(completed("I'm so sorry.")));
  return { rig, s };
}

const whole = (eid: string, text: string) => ({ eid, fieldPath: "text" as const, start: 0, end: text.length - 1, quote: text.slice(0, -1) });
const sub = (entityId: string | null, mentionEid?: { eid: string; text: string; word: string }) => ({
  entityId,
  mention: mentionEid === undefined ? null : { eid: mentionEid.eid, fieldPath: "text" as const, start: mentionEid.text.indexOf(mentionEid.word), end: mentionEid.text.indexOf(mentionEid.word) + mentionEid.word.length, quote: mentionEid.word },
  isSelf: false,
});
const SELF = { entityId: null, mention: null, isSelf: true };

type TItem = Partial<Extract<FastItem, { kind: "transition" }>>;
function transition(text: string, o: TItem | ((eid: string) => TItem)) {
  return (eid: string): FastItem => ({ kind: "transition", transition: "death", subject: SELF, counterpart: null, whenSpoken: null, polarity: "affirmed", act: "direct", span: whole(eid, text), ...(typeof o === "function" ? o(eid) : o) }) as FastItem;
}

async function post(a: Awaited<ReturnType<typeof setup>>, text: string, item: (eid: string) => FastItem, body?: unknown) {
  a.rig.fastSlots.script((input) => ({ kind: "valid", out: { items: [item(input.turn.eid)], need: "none" }, ms: 100 }));
  const before = await memoriesOf(a.rig.store);
  const res = await callRoute(a.rig, turnRoute, body ?? typedTurn(a.s.stamp, 1, text));
  expect(res.status).toBe(200);
  const after = await memoriesOf(a.rig.store);
  const rules = (await a.rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
  const bundle = (await a.rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;
  const notes: string[] = (res.body?.notes ?? []).map((n: { text: string }) => n.text);
  return { res, before, after, changed: changedIds(before, after), rules, bundle, notes, entries: rules.handled.flatMap((h) => h.entries) };
}

const code = (m: Memory | undefined) => (m === undefined ? null : m.value.kind === "enum" ? m.value.code : m.value.kind === "text" ? m.value.text : m.value.kind);
const rowsOf = (m: Map<string, Memory>, pred: string) => [...m.values()].filter((x) => x.predicate === pred).map((x) => [code(x), x.status]).sort();
const routeNotes = (notes: string[]) => notes.filter((n) => (Object.values(ROUTE_NOTE_TEXT) as string[]).includes(n));

describe("the transition route (brief 025 D2)", () => {
  const DEATH = "My dad passed away last night.";

  async function dadSeeded() {
    const a = await setup();
    const dad = mentionEid("person", "dad", a.rig.deps.hasher);
    await seed(a.rig, "My dad has been really sick.", [
      { subjectId: dad, predicate: "person.life", value: { kind: "enum", code: "ill" }, args: { detail: null }, line: "The owner's dad is ill." },
      { subjectId: "self", predicate: "care", value: { kind: "enum", code: "open" }, args: { careSubjectRef: dad, topic: "sick" }, line: "The owner is caring for their dad.", entityIds: [dad] },
    ]);
    return { a, dad };
  }

  it("held: dad is deceased, his care is resolved, the old rows are history, the Head moves, and nothing says saved", async () => {
    const { a, dad } = await dadSeeded();
    const r = await post(a, DEATH, transition(DEATH, (eid) => ({ subject: sub(null, { eid, text: DEATH, word: "My dad" }), whenSpoken: "last night" })));
    expect(rowsOf(r.after, "person.life")).toEqual([["deceased", "active"], ["ill", "history"]]);
    expect(rowsOf(r.after, "care")).toEqual([["open", "history"], ["resolved", "active"]]);
    expect(r.entries.map((e) => [e.route, e.outcome])).toEqual([["transition", "applied"]]);
    expect(routeNotes(r.notes)).toEqual([]);
    expect(r.res.body.stamp.bundleRev).toBeGreaterThan(a.s.stamp.bundleRev);
  });

  it("on the fast path (fastO recorded): the same rows, and no bundle write", async () => {
    const { a, dad } = await dadSeeded();
    const stamp = { ...a.s.stamp, turnId: testId("turn-1") };
    await a.rig.store.transaction(UID, (tx) => recordFastO(tx, { uid: UID, stamp, responseId: "resp_s", opsNow: a.rig.clock.read().opsClock.now, core: { epoch: 1, policyRev: 1 }, audience: "private" }, a.rig.deps));
    const bundleBefore = (await a.rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;
    const r = await post(a, DEATH, transition(DEATH, (eid) => ({ subject: sub(null, { eid, text: DEATH, word: "My dad" }), whenSpoken: "last night" })), asrTurn(a.s.stamp, 1, DEATH, [{ itemId: "item_1", commitSeq: 1 }]));
    expect(rowsOf(r.after, "person.life")).toEqual([["deceased", "active"], ["ill", "history"]]);
    expect(r.bundle.bundleRev).toBe(bundleBefore.bundleRev);
    expect(routeNotes(r.notes)).toEqual([]);
  });

  it("\"I might leave my job.\" writes nothing: careOnly, no note", async () => {
    const a = await setup();
    await seed(a.rig, "I work at Acme as an engineer.", [
      { subjectId: "self", predicate: "employment.role", value: { kind: "text", text: "engineer" }, args: { employerRef: mentionEid("organization", "acme", a.rig.deps.hasher), managerRef: null }, line: "The owner is an engineer at Acme." },
    ]);
    const text = "I might leave my job.";
    const r = await post(a, text, transition(text, { transition: "jobChangeOwn", polarity: "uncertain", act: "uncertain" }));
    expect(r.changed).toEqual([]);
    expect(r.entries.map((e) => [e.route, e.outcome])).toEqual([["transition", "careOnly"]]);
    expect(routeNotes(r.notes)).toEqual([]);
  });

  it("\"My last day is Friday.\" is after now: deferred, nothing written", async () => {
    const a = await setup();
    const text = "My last day is Friday.";
    const r = await post(a, text, transition(text, { transition: "jobChangeOwn", whenSpoken: "Friday" }));
    expect(r.changed).toEqual([]);
    expect(r.entries.map((e) => e.outcome)).toEqual(["deferred"]);
  });

  it("a move closes the owner's home and writes the new one", async () => {
    const a = await setup();
    const H = a.rig.deps.hasher;
    const leeds = mentionEid("place", "leeds", H);
    await seed(a.rig, "I live in Leeds.", [{ subjectId: "self", predicate: "place.residence", value: { kind: "entity", ref: leeds }, args: {}, line: "The owner lives in Leeds." }]);
    const text = "I moved to York last week.";
    const r = await post(a, text, transition(text, (eid) => ({ transition: "move", counterpart: sub(null, { eid, text, word: "York" }), whenSpoken: "last week" })));
    const york = mentionEid("place", "york", H);
    const homes = [...r.after.values()].filter((m) => m.predicate === "place.residence").map((m) => [m.value.kind === "entity" ? m.value.ref : null, m.status]);
    expect(homes).toEqual(expect.arrayContaining([[leeds, "history"], [york, "active"]]));
  });

  it("the owner's job change closes the one role and the boss at that employer", async () => {
    const a = await setup();
    const H = a.rig.deps.hasher;
    const acme = mentionEid("organization", "acme", H);
    const boss = mentionEid("person", "sam", H);
    await seed(a.rig, "I work at Acme as an engineer, and Sam is my boss.", [
      { subjectId: "self", predicate: "employment.role", value: { kind: "text", text: "engineer" }, args: { employerRef: acme, managerRef: null }, line: "The owner is an engineer at Acme." },
      { subjectId: "self", predicate: "person.relation", value: { kind: "enum", code: "boss" }, args: { otherRef: boss, label: "boss", employerRef: acme }, line: "Sam is the owner's boss.", entityIds: [boss] },
    ]);
    const text = "I left my job yesterday.";
    const r = await post(a, text, transition(text, { transition: "jobChangeOwn", whenSpoken: "yesterday" }));
    expect(rowsOf(r.after, "employment.role")).toEqual([["engineer", "history"]]);
    expect(rowsOf(r.after, "person.relation")).toEqual([["boss", "history"]]);
  });

  it("with two roles and no employer named, the owner's job change defers", async () => {
    const a = await setup();
    const H = a.rig.deps.hasher;
    await seed(a.rig, "I work at Acme and at Brill.", [
      { subjectId: "self", predicate: "employment.role", value: { kind: "text", text: "engineer" }, args: { employerRef: mentionEid("organization", "acme", H), managerRef: null }, line: "The owner is an engineer at Acme." },
      { subjectId: "self", predicate: "employment.role", value: { kind: "text", text: "tutor" }, args: { employerRef: mentionEid("organization", "brill", H), managerRef: null }, line: "The owner is a tutor at Brill." },
    ]);
    const text = "I left my job yesterday.";
    const r = await post(a, text, transition(text, { transition: "jobChangeOwn", whenSpoken: "yesterday" }));
    expect(r.changed).toEqual([]);
    expect(r.entries.map((e) => e.outcome)).toEqual(["deferred"]);
  });

  it("a breakup moves the partner relation to history, and a reunion brings it back", async () => {
    const a = await setup();
    const H = a.rig.deps.hasher;
    const sam = mentionEid("person", "sam", H);
    await seed(a.rig, "Sam is my partner.", [{ subjectId: "self", predicate: "person.relation", value: { kind: "enum", code: "partner" }, args: { otherRef: sam, label: "partner", employerRef: null }, line: "Sam is the owner's partner.", entityIds: [sam] }]);
    const split = "Sam and I broke up yesterday.";
    const r = await post(a, split, transition(split, (eid) => ({ transition: "breakup", subject: SELF, counterpart: sub(null, { eid, text: split, word: "Sam" }), whenSpoken: "yesterday" })));
    expect(rowsOf(r.after, "person.relation")).toEqual([["partner", "history"]]);

    a.rig.clock.advance(60_000);
    a.rig.clock.setWorld(a.rig.clock.read().worldClock.now + 60_000);
    const back = "Sam and I got back together today.";
    a.rig.fastSlots.script((input) => ({ kind: "valid", out: { items: [transition(back, { transition: "reunion", counterpart: sub(null, { eid: input.turn.eid, text: back, word: "Sam" }), whenSpoken: "this morning" })(input.turn.eid)], need: "none" }, ms: 100 }));
    const res = await callRoute(a.rig, turnRoute, typedTurn(r.res.body.stamp, 2, back));
    expect(res.status).toBe(200);
    expect(rowsOf(await memoriesOf(a.rig.store), "person.relation")).toEqual([["partner", "active"], ["partner", "history"]]);
  });
});
