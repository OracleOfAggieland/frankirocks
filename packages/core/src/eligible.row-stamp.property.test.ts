/**
 * Row stamp properties over both stored row kinds (R25.3 as read by design CQ 162; contracts §8 fence; brief 014,
 * S6). 1,000 runs each. eligible takes a Memory or an Evidence row; both carry an epoch and a policyRev.
 *   1. FOR ALL Memory and Evidence rows stamped at or below the current policyRev, with a context and Snapshot that
 *      agree on the current epoch and policyRev, `eligible` gives the same answer as for the same row stamped at
 *      the current policyRev.
 *   2. FOR ALL Memory and Evidence rows stamped below the current epoch, whatever their policyRev, status, class,
 *      dirty flag or stage, `eligible` denies them with reason `freshness`, with no barrier set.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Dependent, docRef, eligible } from "./eligible";
import type { Evidence, Memory } from "./schema/records";
import { memRef, sampleCoreDocs, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const EID = testId("ev");
const MID = testId("m1");
type Stage = "project" | "speech" | "read" | "toolReturn";
type Collection = "memories" | "evidence";
type Row = Memory | Evidence;

const rowArb = fc.record({
  collection: fc.constantFrom<Collection>("memories", "evidence"),
  status: fc.constantFrom<Memory["status"]>("active", "active", "scheduled", "history", "alleged", "wrong", "retracted", "blocked"),
  evidenceStatus: fc.constantFrom<Evidence["status"]>("retained", "retained", "blocked", "purged"),
  sourceClass: fc.constantFrom<Memory["sourceClass"]>("U", "C", "O", "T", "M"),
  dirty: fc.boolean(),
  stage: fc.constantFrom<Stage>("project", "speech", "read", "toolReturn"),
});
type RowCase = typeof rowArb extends fc.Arbitrary<infer T> ? T : never;

function rowOf(k: RowCase, epoch: number, policyRev: number): Row {
  return k.collection === "evidence"
    ? sampleEvidence({ epoch, policyRev, status: k.evidenceStatus, dirty: k.dirty })
    : sampleMemory({ epoch, policyRev, status: k.status, sourceClass: k.sourceClass, dirty: k.dirty });
}

/** The answer for `row` read by a context at the Snapshot's own epoch and policyRev. */
function answer(row: Row, collection: Collection, epoch: number, policyRev: number, stage: Stage) {
  const evidence = collection === "evidence" ? (row as Evidence) : sampleEvidence();
  const x: Dependent = collection === "evidence" ? { ref: docRef("evidence", EID, evidence.rev), row } : { ref: memRef(MID), row };
  const memories: [string, Memory][] = collection === "memories" ? [[MID, row as Memory]] : [];
  const s = sampleSnapshot({ memories, evidence: [[EID, evidence]] }, { epoch: { ...sampleCoreDocs().epoch, epoch, policyRev } });
  expect(s.epoch.barrier).toBeNull();
  return eligible(x, sampleEC({ epoch, policyRev, stage }), s);
}

describe("eligible: a stored Memory or Evidence row's stamp", () => {
  it("allows a clean Memory and a clean Evidence row stamped below the current policyRev", () => {
    expect(answer(sampleMemory({ policyRev: 1 }), "memories", 1, 3, "speech")).toEqual({ allow: true, reason: "ok" });
    expect(answer(sampleEvidence({ policyRev: 1 }), "evidence", 1, 3, "speech")).toEqual({ allow: true, reason: "ok" });
  });

  it("1: a row's own policyRev never decides the answer when it is at or below the current policyRev", () => {
    const arb = fc.record({ row: rowArb, epoch: fc.integer({ min: 1, max: 4 }), epochBack: fc.constantFrom(0, 0, 0, 1), policyRev: fc.integer({ min: 1, max: 9 }), back: fc.integer({ min: 0, max: 8 }) });
    fc.assert(
      fc.property(arb, (k) => {
        const rowEpoch = Math.max(1, k.epoch - k.epochBack);
        const stored = rowOf(k.row, rowEpoch, Math.max(1, k.policyRev - k.back));
        const current = rowOf(k.row, rowEpoch, k.policyRev);
        expect(answer(stored, k.row.collection, k.epoch, k.policyRev, k.row.stage)).toEqual(answer(current, k.row.collection, k.epoch, k.policyRev, k.row.stage));
      }),
      { numRuns: 1000 },
    );
  });

  it("2: every row stamped below the current epoch is denied with reason freshness", () => {
    const arb = fc.record({ row: rowArb, epoch: fc.integer({ min: 2, max: 6 }), back: fc.integer({ min: 1, max: 5 }), policyRev: fc.integer({ min: 1, max: 9 }), up: fc.integer({ min: 0, max: 3 }) });
    fc.assert(
      fc.property(arb, (k) => {
        const row = rowOf(k.row, Math.max(1, k.epoch - k.back), k.policyRev + k.up);
        expect(answer(row, k.row.collection, k.epoch, k.policyRev, k.row.stage)).toEqual({ allow: false, reason: "freshness" });
      }),
      { numRuns: 1000 },
    );
  });
});
