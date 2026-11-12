/**
 * Store contents for the memory-view properties (brief 020): Memories of every status, class, Sensitivity and flow,
 * some stamped below the current epoch (forgotten: the fence of contracts §8), some dirty, some depending on a
 * blocked Evidence; message and turn Evidence; ledger decisions, with repeated IDs. Test-only.
 */
import fc from "fast-check";
import type { Snapshot } from "../eligible";
import type { Au, Sens } from "../schema/primitives";
import type { Evidence, Ledger, Memory } from "../schema/records";
import type { LabInput, ViewContext, ViewRow } from "../memory-views";
import { sampleEC, sampleSnapshot } from "./eligibility";
import { T0, UID, commonFields, sampleCoreDocs, sampleEvidence, sampleMemory, sampleSlice, testId } from "./samples";

/** The current epoch of every generated store; a row stamped 1 is below it. */
export const STORE_EPOCH = 2;

const STATUSES = ["active", "scheduled", "history", "alleged", "wrong", "retracted", "blocked"] as const;
const CLASSES = ["U", "C", "O", "T", "M"] as const;
const SENS = ["S0", "S1", "S2"] as const;

export const memoryCase = fc.record({
  status: fc.constantFrom(...STATUSES),
  sourceClass: fc.constantFrom(...CLASSES),
  sens: fc.constantFrom(...SENS),
  flow: fc.constantFrom("open", "never_outbound"),
  forgotten: fc.boolean(),
  dirty: fc.boolean(),
  /** Index of the Evidence it depends on. */
  dep: fc.integer({ min: 0, max: 2 }),
  text: fc.constantFrom("My dog is called Pip", "I work at the bakery", "Biscuit has surgery Thursday", "I like spicy food"),
  assertedDay: fc.integer({ min: 1, max: 28 }),
});
export type MemoryCase = MemoryCaseT;

export const evidenceCase = fc.record({
  kind: fc.constantFrom("message", "turn", "calendar"),
  status: fc.constantFrom("retained", "blocked", "purged"),
  sens: fc.constantFrom(...SENS),
});
export type EvidenceCase = EvidenceCaseT;

export const decisionCase = fc.record({
  /** Small range, so the same ID repeats: counts are of distinct decisions. */
  idx: fc.integer({ min: 0, max: 12 }),
  state: fc.constantFrom("complete", "blocked", "pending", "failed"),
  reasons: fc.subarray(["ok", "blocked", "audience", "quiet", "time"] as const),
  /** Index into the memories this decision accepted, or -1. */
  memory: fc.integer({ min: -1, max: 30 }),
});
export type DecisionCase = DecisionCaseT;

export const storeCase = (maxMemories = 24) =>
  fc.record({
    memories: fc.array(memoryCase, { maxLength: maxMemories }),
    evidence: fc.array(evidenceCase, { minLength: 3, maxLength: 6 }),
    decisions: fc.array(decisionCase, { maxLength: 16 }),
    audience: fc.constantFrom<Au>("private", "company", "unknown"),
  });
export type StoreCase = StoreCaseT;

type Arb<A> = A extends fc.Arbitrary<infer T> ? T : never;
type MemoryCaseT = Arb<typeof memoryCase>;
type EvidenceCaseT = Arb<typeof evidenceCase>;
type DecisionCaseT = Arb<typeof decisionCase>;
type StoreCaseT = Arb<ReturnType<typeof storeCase>>;

const pad = (n: number) => String(n).padStart(2, "0");

export interface BuiltStore {
  rows: ViewRow[];
  evidence: Map<string, Evidence>;
  evidenceRows: { id: string; evidence: Evidence }[];
  decisions: { id: string; entry: Ledger }[];
  snapshot: Snapshot;
  ctx: ViewContext;
  lab: LabInput;
}

export function buildStore(k: StoreCase): BuiltStore {
  const epoch = { ...sampleCoreDocs().epoch, epoch: STORE_EPOCH };
  const evidenceRows = k.evidence.map((e, i) => {
    const id = testId(`ev${i}`);
    const text = "I said something worth keeping here.";
    const ev = sampleEvidence({
      ...commonFields({ epoch: STORE_EPOCH }),
      kind: e.kind as Evidence["kind"],
      status: e.status as Evidence["status"],
      text: { kind: "inline", text },
      fieldSlices: [sampleSlice({ eid: id, sens: e.sens as Sens, start: 0, end: text.length })],
    } as Partial<Evidence>);
    return { id, evidence: ev };
  });
  const rows: ViewRow[] = k.memories.map((m, i) => {
    const id = testId(`m${i}`);
    const eid = evidenceRows[m.dep % evidenceRows.length]!.id;
    const memory: Memory = sampleMemory({
      ...commonFields({
        epoch: m.forgotten ? STORE_EPOCH - 1 : STORE_EPOCH,
        dirty: m.dirty,
        rootKeys: [testId(`root${i}`)],
        rootSlices: [sampleSlice({ eid, sens: m.sens, start: 0, end: 6 })],
        packetEids: [eid],
        dependsOn: [`e:${eid}`],
      }),
      key: testId(`key${i}`),
      logicalId: testId(`log${i}`),
      status: m.status,
      sourceClass: m.sourceClass,
      sens: m.sens,
      flow: m.flow as Memory["flow"],
      value: { kind: "text", text: m.text },
      assertedAt: `2026-10-${pad(m.assertedDay)}T12:00:00.000Z`,
      validFrom: T0,
      supportingIds: [{ type: "evidence", id: eid, rev: 1 }],
    } as Partial<Memory>);
    return { id, memory };
  });
  // One entry per ID (as in a store), and every even ID read twice (as across two overlapping pages).
  const unique = [...new Map(k.decisions.map((d) => [d.idx, d])).values()];
  const reads = [...unique, ...unique.filter((d) => d.idx % 2 === 0)];
  const decisions = reads.map((d) => {
    const id = testId(`d${d.idx}`);
    const target = d.memory >= 0 && d.memory < rows.length ? rows[d.memory]! : null;
    const entry: Ledger = {
      ...commonFields({ epoch: STORE_EPOCH }),
      kind: "decision",
      state: d.state,
      at: T0,
      retainUntil: null,
      payload: {
        purpose: "answer",
        acceptedRefs: target === null ? [] : [{ type: "memory", id: target.id, rev: target.memory.rev }],
        heldRefs: [],
        reasonCodes: [...d.reasons],
        audience: k.audience,
      },
    } as Ledger;
    return { id, entry };
  });
  const snapshot = sampleSnapshot(
    { memories: rows.map((r) => [r.id, r.memory] as [string, Memory]), evidence: evidenceRows.map((e) => [e.id, e.evidence] as [string, Evidence]) },
    { epoch },
  );
  const ec = sampleEC({ epoch: STORE_EPOCH, audience: k.audience, worldNow: T0 });
  const ctx: ViewContext = { ec, snapshot, noteFor: (id) => id, expiresAt: "2026-11-03T12:01:00.000Z" };
  const evidence = new Map(evidenceRows.map((e) => [e.id, e.evidence]));
  const lab: LabInput = { ec, snapshot, memories: rows, evidence: evidenceRows, decisions, complete: true };
  return { rows, evidence, evidenceRows, decisions, snapshot, ctx, lab };
}

export { UID };
