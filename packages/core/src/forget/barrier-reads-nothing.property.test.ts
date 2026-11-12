// Feature: forget (brief 021), Property FP5: under a barrier nothing is read (spec §8 step 2 "Recall returns nothing
// and writers wait"; contracts §4 eligible clauses 2 and 3; design note 021 ruling F-1). For any read while a barrier
// is up, in any context (any stage, execution, verb and purpose, with or without a maintenance claim on the
// barrier's own op), `eligible` denies every row, and `recallLines` returns no line.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ELIGIBILITY_STAGES, VERBS, eligible } from "../eligible";
import { recallLines } from "../recall";
import { Purpose } from "../schema/primitives";
import type { Evidence } from "../schema/records";
import { memRef, sampleEC, sampleSnapshot } from "../testing/eligibility";
import { sampleJob, sampleMemory, testId } from "../testing/samples";

const PURPOSES = ["extract", "commit", "answer", "proactive", "plan", "action", "inspect"] as const satisfies readonly Purpose[];
const PHASES = ["fence", "close", "resolve", "install", "closure", "resume"] as const;

const caseArb = fc.record({
  stage: fc.constantFrom(...ELIGIBILITY_STAGES),
  execution: fc.constantFrom("browser" as const, "serverForeground" as const, "worker" as const),
  operation: fc.constantFrom(...VERBS),
  purpose: fc.constantFrom(...PURPOSES),
  phase: fc.constantFrom(...PHASES),
  maintenance: fc.constantFrom("none" as const, "matching" as const, "other" as const),
  task: fc.constantFrom("resolve" as const, "sanitize" as const, "purge" as const),
  serviceAuthorized: fc.boolean(),
  explicitRequest: fc.boolean(),
  rows: fc.integer({ min: 1, max: 5 }),
  status: fc.constantFrom("active" as const, "scheduled" as const, "history" as const),
});

describe("FP5: under a barrier nothing is read", () => {
  it("eligible denies every row and recall returns no line", () => {
    fc.assert(
      fc.property(caseArb, (k) => {
        const opId = testId("op");
        const barrier = { opId, phase: k.phase, startedAt: "2026-11-03T12:00:00.000Z", deadline: "2026-11-03T12:00:01.500Z", queuedOps: [] };
        const memories = Array.from({ length: k.rows }, (_, i) => [testId(`m${i}`), sampleMemory({ status: k.status, logicalId: testId(`l${i}`) })] as [string, ReturnType<typeof sampleMemory>]);
        const job = sampleJob({ leaseToken: testId("lease"), generation: 1 });
        const base = sampleSnapshot({ memories }, { job });
        const s = { ...base, epoch: { ...base.epoch, barrier } };
        const c = sampleEC({
          stage: k.stage,
          execution: k.execution,
          operation: k.operation,
          purpose: k.purpose,
          explicitRequest: k.explicitRequest,
          serviceAuthorized: k.serviceAuthorized,
          maintenanceOpId: k.maintenance === "none" ? null : k.maintenance === "matching" ? opId : testId("other"),
          maintenanceTask: k.maintenance === "none" ? null : k.task,
          leaseToken: testId("lease"),
          jobGeneration: 1,
        });
        for (const [id, m] of memories) expect(eligible({ ref: memRef(id), row: m }, c, s).allow).toBe(false);
        const out = recallLines(
          memories.map(([id, memory]) => ({ id, memory })),
          c,
          s,
          new Map<string, Evidence>(),
        );
        expect(out.lines).toEqual([]);
        expect(out.eligibleCount).toBe(0);
      }),
      { numRuns: 1000 },
    );
  });
});
