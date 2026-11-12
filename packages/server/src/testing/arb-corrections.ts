/**
 * Correction turns and their driver, for the properties of brief 012 wave C (task C1): P7
 * (`worker/extract.no-double-apply.property.test.ts`), P8 (`routes/turn.successor-lineage.property.test.ts`) and P9
 * (`routes/turn.correction-ack.property.test.ts`). Plain module.
 *
 * The store starts with two of the owner's Memories from an earlier turn ("My sister Maya is coming Friday. My name
 * is Alec."): the sister's relation row and the owner's own name row. One correction turn follows, typed or ASR: a
 * rename of the sister, a correction of the owner's name, a retraction of the sister, the same name said again, or a
 * correction naming a target the packet never showed. Fake_FastSlots answers with the careful item, or invalid,
 * transport, a timeout or `need`; the Fake Decisions answer carries a `correct` candidate and an uncertain speaker or
 * not; the commit may fail on its first attempt. After the turn, extraction can run with a Fake_OpenAI output that
 * repeats the handled item, says the new name as a mention, or adds an unrelated item.
 */
import { type Evidence, type FastItem, type FastSlotsInput, type Job, type Memory, type Session, type Span, idParts, keyOf, mentionEid, mentionName, rootKey, turnTextSlice } from "@franki/core";
import { sampleMemory, testId } from "@franki/core/testing";
import fc from "fast-check";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { readAllMemories, storeReader } from "../head-build";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { decisionAnswer } from "./decisions";
import { type CommittedTurn, commitUserTurnForTest, extractOutput, factItem } from "./extract-fixtures";
import type { FakeSlotsAnswer } from "./fake-fast-slots";
import { type TestRig, callRoute, failingStore, patchRecord, settle, testRig } from "./fakes";
import { asrTurn, openTestSession, typedTurn } from "./session-fixtures";

export const UID = "owner-1";
export const SISTER_NAMES = ["Maya", "Mara", "May"] as const;
export const SELF_NAMES = ["Alec", "Alex", "Al"] as const;
export const PRIOR_TEXT = (sister: string) => `My sister ${sister} is coming Friday. My name is Alec.`;

export type CorrectionKind = "rename" | "value" | "retract" | "same" | "unknownTarget";
export type SlotsMode = "valid" | "invalid" | "transport" | "never" | "need";
export type ExtractionMode = "none" | "repeat" | "newMention" | "unrelated";

export interface CorrectionSpec {
  kind: CorrectionKind;
  oldName: string;
  newName: string;
  selfName: string;
  source: "typed" | "asr";
  slots: SlotsMode;
  uncertain: boolean;
  commitFails: boolean;
  extraction: ExtractionMode;
}

export const correctionSpecArb: fc.Arbitrary<CorrectionSpec> = fc.record({
  kind: fc.constantFrom<CorrectionKind>("rename", "rename", "value", "retract", "same", "unknownTarget"),
  oldName: fc.constantFrom(...SISTER_NAMES),
  newName: fc.constantFrom(...SISTER_NAMES),
  selfName: fc.constantFrom("Alex", "Al", "Alexa"),
  source: fc.constantFrom<"typed" | "asr">("typed", "asr"),
  slots: fc.oneof({ weight: 5, arbitrary: fc.constant<SlotsMode>("valid") }, { weight: 1, arbitrary: fc.constantFrom<SlotsMode>("invalid", "transport", "never", "need") }),
  uncertain: fc.boolean(),
  commitFails: fc.boolean(),
  extraction: fc.constantFrom<ExtractionMode>("none", "repeat", "newMention", "unrelated"),
});

export interface Seeded {
  prior: CommittedTurn;
  sister: string;
  relId: string;
  selfNameId: string;
}

const say = (text: string) => ({ text, entityRefs: [], timeFields: [] });

/** The earlier turn's Evidence (its job already done) and the two Memories extraction wrote from it. */
export async function seedPrior(rig: TestRig, oldName: string): Promise<Seeded> {
  const H = rig.deps.hasher;
  const prior = await commitUserTurnForTest(rig.store, UID, testId("prior"), PRIOR_TEXT(oldName), rig.clock, H);
  await patchRecord<Job>(rig.store, UID, paths.job(UID, prior.jobId), { status: "complete" } as Partial<Job>);
  const slice = turnTextSlice(prior.eid, prior.text, "U", H);
  const lineage = { rootSlices: [slice], rootKeys: [rootKey(slice, H)], packetEids: [prior.eid], dependsOn: [`e:${prior.eid}`], supportingIds: [{ type: "evidence" as const, id: prior.eid, rev: 1 }] };
  const sister = mentionEid("person", mentionName(oldName), H);
  const relArgs = { otherRef: sister, label: "sister", employerRef: null };
  const relValue = { kind: "enum" as const, code: "sister" };
  const rel = keyOf("self", "person.relation", relArgs, relValue, H);
  const nameValue = { kind: "text" as const, text: "Alec" };
  const own = keyOf("self", "identity.name", {}, nameValue, H);
  const relId = H.id(idParts.memory(prior.jobId, 0));
  const selfNameId = H.id(idParts.memory(prior.jobId, 1));
  const at = (await rig.store.get<Evidence>(UID, paths.evidence(UID, prior.eid)))!.data.assertedAt;
  const relRow: Memory = sampleMemory({
    uid: UID,
    logicalId: relId,
    ...lineage,
    subjectId: "self",
    predicate: "person.relation",
    kind: "fact",
    value: relValue,
    args: relArgs,
    scopeId: rel.scopeId,
    key: rel.key,
    entityIds: [sister],
    sayAs: say(`${oldName} is the owner's sister.`),
    assertedAt: at,
    validFrom: at,
    validFromKey: at,
  } as Partial<Memory>);
  const nameRow: Memory = sampleMemory({
    uid: UID,
    logicalId: selfNameId,
    ...lineage,
    subjectId: "self",
    predicate: "identity.name",
    kind: "fact",
    value: nameValue,
    args: {},
    scopeId: own.scopeId,
    key: own.key,
    entityIds: [],
    sayAs: say("The owner's name is Alec."),
    assertedAt: at,
    validFrom: at,
    validFromKey: at,
  } as Partial<Memory>);
  await rig.store.transaction(UID, async (tx) => {
    tx.create(paths.memory(UID, relId), relRow);
    tx.create(paths.memory(UID, selfNameId), nameRow);
  });
  return { prior, sister, relId, selfNameId };
}

/** The correction turn's words and the item a careful model returns for them. */
export function correctionTurn(spec: CorrectionSpec, seeded: Seeded): { text: string; item: (eid: string) => FastItem } {
  const span = (eid: string, text: string): Span => ({ eid, fieldPath: "text", start: 0, end: text.length - 1, quote: text.slice(0, -1) });
  const correction = (text: string, targetIds: string[], predicate: "identity.name" | "person.relation", replacement: string | null) => (eid: string): FastItem => ({
    kind: "correction",
    targetIds,
    predicate,
    replacementValue: replacement === null ? null : { kind: "text", text: replacement },
    args: null,
    act: "direct",
    span: span(eid, text),
  });
  switch (spec.kind) {
    case "rename": {
      const text = `No, her name is ${spec.newName}, not ${spec.oldName}.`;
      return { text, item: correction(text, [seeded.relId], "identity.name", spec.newName) };
    }
    case "same": {
      const text = `No, her name is ${spec.oldName}.`;
      return { text, item: correction(text, [seeded.relId], "identity.name", spec.oldName) };
    }
    case "value": {
      const text = `No, my name is ${spec.selfName}, not Alec.`;
      return { text, item: correction(text, [seeded.selfNameId], "identity.name", spec.selfName) };
    }
    case "retract": {
      const text = `I don't have a sister named ${spec.oldName}, that was wrong.`;
      return { text, item: correction(text, [seeded.relId], "person.relation", null) };
    }
    case "unknownTarget": {
      const text = `No, her name is ${spec.newName}.`;
      return { text, item: correction(text, [testId("not-shown")], "identity.name", spec.newName) };
    }
  }
}

function slotsAnswer(spec: CorrectionSpec, item: (eid: string) => FastItem): (input: FastSlotsInput) => FakeSlotsAnswer {
  return (input) => {
    switch (spec.slots) {
      case "valid":
        return { kind: "valid", out: { items: [item(input.turn.eid)], need: "none" }, ms: 120 };
      case "need":
        return { kind: "valid", out: { items: [item(input.turn.eid)], need: "target" }, ms: 120 };
      case "invalid":
        return { kind: "invalid", reason: "shape", path: "$.items", ms: 120 };
      case "transport":
        return { kind: "transport", ms: 5 };
      case "never":
        return { kind: "never" };
    }
  };
}

export interface CorrectionTrace {
  rig: TestRig;
  spec: CorrectionSpec;
  seeded: Seeded;
  text: string;
  status: number;
  response: any;
  failed: any[];
  evidenceId: string | null;
  before: Map<string, Memory>;
  /** After the route, before extraction ran. */
  afterRoute: Map<string, Memory>;
  /** After extraction ran (equal to `afterRoute` when `extraction` is `none`). */
  afterExtract: Map<string, Memory>;
  /** The route should have applied the correction: a valid, applicable answer on a speaker-certain turn. */
  applicable: boolean;
}

export async function memoriesOf(store: StorePort): Promise<Map<string, Memory>> {
  const rows = await readAllMemories(storeReader(store, UID), UID);
  return new Map(rows.map((d) => [d.id, d.memory]));
}

/** What extraction's Fake_OpenAI returns for the correction turn. */
function extractionOutput(spec: CorrectionSpec, text: string, eid: string): unknown[] {
  const span = (start: number, end: number) => ({ eid, fieldPath: "text" as const, start, end, quote: text.slice(start, end) });
  const unrelated = (() => {
    // An unrelated item is the whole text read as a plain fact.
    return { ...factItem("statement", "new", text.slice(0, -1), [span(0, text.length - 1)]) };
  })();
  switch (spec.extraction) {
    case "none":
      return [];
    case "unrelated":
      return [unrelated];
    case "repeat": {
      if (spec.kind === "value") {
        const at = text.indexOf(spec.selfName);
        return [{ ...factItem("correction", "new", spec.selfName, [span(at, at + spec.selfName.length)]), predicate: "identity.name", args: {} }];
      }
      const at = text.indexOf(spec.newName);
      return [{ ...factItem("correction", "update", "", [span(0, text.length - 1)]), changes: [{ verb: "correct", targetMid: testId("unseen") }], value: { kind: "text", text: spec.newName }, predicate: "fact", args: { topic: "other", label: null }, spans: [span(at, at + spec.newName.length)] }];
    }
    case "newMention": {
      const name = spec.kind === "value" ? spec.selfName : spec.newName;
      const at = Math.max(0, text.indexOf(name));
      const { predicate: _p, kind: _k, value: _v, args: _a, ...rest } = factItem("statement", "new", "", [span(0, text.length - 1)]);
      return [
        {
          ...rest,
          mentions: [{ localId: "m1", type: "person", observedName: name, span: span(at, at + name.length), existingId: null }],
          claim: { predicate: "person.relation", kind: "fact", value: { kind: "enum", code: "sister" }, args: { otherRef: "m1", label: "sister", employerRef: null } },
        },
      ];
    }
  }
}

/** Seeds, posts the correction turn (retrying a failed commit as the browser would), then runs extraction. */
export async function runCorrection(spec: CorrectionSpec): Promise<CorrectionTrace> {
  const rig = testRig();
  let failNext = false;
  rig.deps.store = failingStore(rig.store, () => {
    if (!failNext) return false;
    failNext = false;
    return true;
  });
  const seeded = await seedPrior(rig, spec.oldName);
  const s = await openTestSession(rig);
  // A call is open, so the route note reaches the reply (with no call, a typed turn gets one Franki line, G17).
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  const t = correctionTurn(spec, seeded);
  // The same answers on a retried commit, as a real retry would get them again.
  rig.openai.always("decisions.create", ok(decisionAnswer({ correct: 0.9, uncertainSpeaker: spec.uncertain ? 0.4 : 0.01 })));
  rig.fastSlots.always(slotsAnswer(spec, t.item));
  const before = await memoriesOf(rig.store);
  const body = spec.source === "asr" ? asrTurn(s.stamp, 1, t.text, [{ itemId: "item_1", commitSeq: 1 }]) : typedTurn(s.stamp, 1, t.text);
  failNext = spec.commitFails;
  const failed: any[] = [];
  // The typed reply and every later model call answer plainly; extraction's answer is scripted below.
  rig.openai.script("responses.create", ok(completed("All right.")));
  let res = await callRoute(rig, turnRoute, body);
  if (res.status !== 200) {
    failed.push(res.body);
    res = await callRoute(rig, turnRoute, body);
  }
  const turnDoc = await rig.store.get<{ evidenceId: string | null }>(UID, paths.turn(UID, s.sessionId, testId("turn-1")));
  const evidenceId = turnDoc?.data.evidenceId ?? null;
  const afterRoute = await memoriesOf(rig.store);
  if (evidenceId !== null) rig.openai.always("responses.create", ok(completed(JSON.stringify(extractOutput(extractionOutput(spec, t.text, evidenceId))))));
  await settle(rig.sched.runAll(), rig.clock, rig.timers);
  const afterExtract = await memoriesOf(rig.store);
  const certain = spec.source === "typed" || !spec.uncertain;
  // The route acts only on a target the packet showed: code chooses them as extraction's `open` does, so a line that
  // shares no content word with the turn ("May" is a stop word) is never a target.
  const target = spec.kind === "value" ? seeded.selfNameId : seeded.relId;
  const shown = rig.fastSlots.calls.some((c) => c.input.targets.some((x) => x.id === target));
  const applicable = res.status === 200 && spec.slots === "valid" && certain && shown && (spec.kind === "rename" ? spec.newName !== spec.oldName : spec.kind === "value" || spec.kind === "retract");
  return { rig, spec, seeded, text: t.text, status: res.status, response: res.body, failed, evidenceId, before, afterRoute, afterExtract, applicable };
}

/** Memories that differ between two reads (added or changed). */
export function changedIds(a: ReadonlyMap<string, Memory>, b: ReadonlyMap<string, Memory>): string[] {
  return [...b.keys()].filter((id) => JSON.stringify(a.get(id) ?? null) !== JSON.stringify(b.get(id)));
}
