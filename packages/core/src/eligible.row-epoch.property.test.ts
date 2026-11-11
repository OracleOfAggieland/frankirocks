/**
 * Row epoch property (R25.3; contracts §8 fence; brief 014, S6). 1,000 runs.
 *   FOR ALL rows stamped below the current epoch, whatever their policyRev, status, class or stage, `eligible`
 *   denies them with reason `freshness`, and no barrier or dirty flag is needed for it. Forget raises the epoch
 *   (contracts §8), so this is the fence that keeps a forgotten row out of every reader.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Dependent, eligible } from "./eligible";
import { memRef, sampleCoreDocs, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const EID = testId("ev");
const MID = testId("m1");

const caseArb = fc
  .record({
    epoch: fc.integer({ min: 2, max: 6 }),
    back: fc.integer({ min: 1, max: 5 }),
    policyRev: fc.integer({ min: 1, max: 9 }),
    rowPolicyRevUp: fc.integer({ min: 0, max: 3 }),
    status: fc.constantFrom("active", "history"),
    sourceClass: fc.constantFrom("U", "C", "O"),
    stage: fc.constantFrom("project", "speech", "read", "toolReturn"),
  })
  .map((r) => ({ ...r, rowEpoch: Math.max(1, r.epoch - r.back) }));

describe("eligible: a stored row's epoch", () => {
  it("denies every row stamped below the current epoch with reason freshness", () => {
    fc.assert(
      fc.property(caseArb, (k) => {
        // A row stamped at or above the current policyRev too: only its epoch can deny it.
        const memory = sampleMemory({ epoch: k.rowEpoch, policyRev: k.policyRev + k.rowPolicyRevUp, status: k.status, sourceClass: k.sourceClass });
        const x: Dependent = { ref: memRef(MID), row: memory };
        const s = sampleSnapshot({ memories: [[MID, memory]], evidence: [[EID, sampleEvidence()]] }, { epoch: { ...sampleCoreDocs().epoch, epoch: k.epoch, policyRev: k.policyRev } });
        expect(eligible(x, sampleEC({ epoch: k.epoch, policyRev: k.policyRev, stage: k.stage }), s)).toEqual({ allow: false, reason: "freshness" });
      }),
      { numRuns: 1000 },
    );
  });
});
