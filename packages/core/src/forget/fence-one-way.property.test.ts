// Feature: forget (brief 021), Property FP4: the fence is one-way and the queue drains (spec §8 step 2; contracts
// §1 core/epoch, §8 step 2; KV07). For any order of forgets, retries and releases, through `planFence` and
// `releaseBarrier`:
//   - the epoch and the policy revision never fall;
//   - a retry of a known op writes nothing and keeps the stamps that op first captured;
//   - the barrier is null exactly when every admitted op has been released, its owner is the oldest unreleased op,
//     and its queue holds the rest in arrival order;
//   - a full queue refuses with BARRIER and changes nothing.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tsFromMs, msFromTs } from "../schema/primitives";
import type { CoreEpoch } from "../schema/records";
import { T0, sampleCoreDocs, testId } from "../testing/samples";
import { FENCE_QUEUE_MAX, type Stamps, planFence, releaseBarrier } from "./fence";

type Action = { t: "forget"; op: number } | { t: "release"; op: number | null };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 40 }).map((op) => ({ t: "forget" as const, op })) },
  { weight: 2, arbitrary: fc.option(fc.integer({ min: 0, max: 40 }), { nil: null }).map((op) => ({ t: "release" as const, op })) },
);

describe("FP4: the fence is one-way and the queue drains", () => {
  it("revisions never fall, retries keep their stamps, the barrier clears exactly when the queue is empty", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 80 }), fc.boolean(), (actions, burst) => {
        let epoch: CoreEpoch = sampleCoreDocs().epoch;
        let now = msFromTs(T0);
        const first = new Map<string, Stamps>();
        const jobs = new Map<string, Stamps>();
        let active: string[] = [];
        const seq: Action[] = burst ? [...Array.from({ length: 40 }, (_, i) => ({ t: "forget" as const, op: i })), ...actions] : actions;
        for (const a of seq) {
          now += 10;
          const before = { epoch: epoch.epoch, policyRev: epoch.policyRev };
          if (a.t === "forget") {
            const opId = testId(`op${a.op}`);
            const plan = planFence(epoch, { opId, requestRef: null, requestTurnIds: [] }, tsFromMs(now), jobs.get(opId) ?? null);
            if (first.has(opId)) {
              expect(plan.kind).toBe("retry");
              if (plan.kind === "retry") expect(plan.captured).toEqual(first.get(opId));
            } else if (active.length > FENCE_QUEUE_MAX) {
              expect(plan).toEqual({ kind: "refused", code: "BARRIER" });
            } else if (active.length === 0) {
              expect(plan.kind).toBe("fenced");
              if (plan.kind === "fenced") {
                epoch = plan.epoch;
                first.set(opId, plan.captured);
                jobs.set(opId, plan.captured);
                active.push(opId);
              }
            } else {
              expect(plan.kind).toBe("queued");
              if (plan.kind === "queued") {
                expect(plan.captured).toEqual(before);
                epoch = plan.epoch;
                first.set(opId, plan.captured);
                active.push(opId);
              }
            }
          } else {
            const opId = a.op === null ? (active[0] ?? testId("none")) : testId(`op${a.op}`);
            const plan = releaseBarrier(epoch, opId, tsFromMs(now));
            if (active[0] !== opId) {
              expect(plan.kind).toBe("notOwner");
            } else {
              active = active.slice(1);
              if (active.length === 0) {
                expect(plan.kind).toBe("cleared");
              } else {
                expect(plan.kind).toBe("promoted");
                if (plan.kind === "promoted") {
                  expect(plan.opId).toBe(active[0]);
                  expect(plan.captured).toEqual(first.get(active[0]!));
                  jobs.set(active[0]!, plan.captured);
                }
              }
              if (plan.kind !== "notOwner") epoch = plan.epoch;
            }
          }
          expect(epoch.epoch).toBeGreaterThanOrEqual(before.epoch);
          expect(epoch.policyRev).toBeGreaterThanOrEqual(before.policyRev);
          expect(epoch.barrier === null).toBe(active.length === 0);
          if (epoch.barrier !== null) {
            expect(epoch.barrier.opId).toBe(active[0]);
            expect(epoch.barrier.queuedOps.map((q) => q.opId)).toEqual(active.slice(1));
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
