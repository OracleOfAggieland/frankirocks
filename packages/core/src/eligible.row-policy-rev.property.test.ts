/**
 * Row policyRev property (R25.3 as read by design CQ 162; brief 014, S6). 1,000 runs.
 *   FOR ALL rows stamped at or below the current policyRev, with a context and Snapshot that agree on the current
 *   epoch and policyRev, `eligible` gives the same answer as for the same row stamped at the current policyRev.
 *   A stored row's own policyRev records when it was written; it never decides whether the row may be read.
 *   policyRev rises cancel speech and Decks (KV05); they do not hide what was stored before them.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Dependent, eligible } from "./eligible";
import type { Memory } from "./schema/records";
import { memRef, sampleCoreDocs, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const EID = testId("ev");
const MID = testId("m1");

const caseArb = fc
  .record({
    epoch: fc.integer({ min: 1, max: 4 }),
    policyRev: fc.integer({ min: 1, max: 9 }),
    rowEpochBack: fc.constantFrom(0, 0, 0, 1),
    rowPolicyRevBack: fc.integer({ min: 0, max: 8 }),
    status: fc.constantFrom("active", "active", "history", "wrong", "blocked"),
    sourceClass: fc.constantFrom("U", "C", "O", "T", "M"),
    dirty: fc.constantFrom(false, false, false, true),
    stage: fc.constantFrom("project", "speech", "read", "toolReturn"),
  })
  .map((r) => ({ ...r, rowEpoch: Math.max(1, r.epoch - r.rowEpochBack), rowPolicyRev: Math.max(1, r.policyRev - r.rowPolicyRevBack) }));

function answer(memory: Memory, epoch: number, policyRev: number, stage: "project" | "speech" | "read" | "toolReturn") {
  const x: Dependent = { ref: memRef(MID), row: memory };
  const s = sampleSnapshot({ memories: [[MID, memory]], evidence: [[EID, sampleEvidence()]] }, { epoch: { ...sampleCoreDocs().epoch, epoch, policyRev } });
  return eligible(x, sampleEC({ epoch, policyRev, stage }), s);
}

describe("eligible: a stored row's policyRev", () => {
  it("never decides the answer when the row is at or below the current policyRev", () => {
    fc.assert(
      fc.property(caseArb, (k) => {
        const fields = { epoch: k.rowEpoch, status: k.status, sourceClass: k.sourceClass, dirty: k.dirty } as Partial<Memory>;
        const stored = sampleMemory({ ...fields, policyRev: k.rowPolicyRev });
        const current = sampleMemory({ ...fields, policyRev: k.policyRev });
        expect(answer(stored, k.epoch, k.policyRev, k.stage)).toEqual(answer(current, k.epoch, k.policyRev, k.stage));
      }),
      { numRuns: 1000 },
    );
  });
});
