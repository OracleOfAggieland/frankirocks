// Feature: one-shot time (brief 023), property "Identity is stable" (spec §5 "A moment's ID comes from the memory,
// its kind and its original occurrence. A moved interview keeps its identity and its said"). For any occasion and any
// chain of moves, the successor's moments carry the same IDs as the original's, kind by kind, and merging the moved
// plan into a stored moment that was said never changes its ID, status or saidAt.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Memory } from "../schema/records";
import { tsFromMs } from "../schema/primitives";
import { deriveOccasion } from "./derive";
import { mergeMoment, momentRow } from "./merge";
import { memId, momentHasher, moved, occasionMemory, occasionSpecArb, type OccasionSpec } from "./testing/arb-moments";

const instantSpec = occasionSpecArb.map((s): OccasionSpec => ({ ...s, precision: "instant" }));
const CTX = { uid: "owner-1", opsNow: Date.UTC(2026, 10, 12), epoch: 1, policyRev: 1, clockMode: "fixture" as const };

describe("one-shot time: identity is stable", () => {
  it("a moved occasion keeps its moment IDs and its said", () => {
    fc.assert(
      fc.property(instantSpec, fc.array(fc.integer({ min: -3 * 24 * 60, max: 3 * 24 * 60 }), { minLength: 1, maxLength: 4 }), (spec, shifts) => {
        const first = occasionMemory(memId(0), spec);
        const rows = new Map<string, Memory>([[first.logicalId, first]]);
        let current = first;
        shifts.forEach((minutes, i) => {
          const next = moved({ ...current, status: "history" }, memId(i + 1), { ...spec, startMs: spec.startMs + minutes * 60_000 });
          rows.set(current.logicalId, { ...current, status: "history" });
          rows.set(next.logicalId, next);
          current = next;
        });
        const before = deriveOccasion(first, new Map([[first.logicalId, first]]), momentHasher);
        const after = deriveOccasion(current, rows, momentHasher);
        const kindsBefore = new Map(before.plans.map((p) => [p.kind, p.momentId]));
        const all = new Set([...before.plans.map((p) => p.momentId), ...before.retired]);
        for (const p of after.plans) if (kindsBefore.has(p.kind)) expect(p.momentId).toBe(kindsBefore.get(p.kind));
        // Every ID after the moves is one the original owned (planned or retired).
        for (const id of [...after.plans.map((p) => p.momentId), ...after.retired]) expect(all.has(id)).toBe(true);
        // A said moment is never rewritten by the move.
        for (const p of before.plans) {
          const said = { ...momentRow(p, CTX, momentHasher), status: "delivered" as const, admittedAt: tsFromMs(CTX.opsNow), saidAt: tsFromMs(CTX.opsNow), saidMatch: "exactTemplate" as const };
          const movedPlan = after.plans.find((q) => q.kind === p.kind);
          if (movedPlan !== undefined) expect(mergeMoment(said, movedPlan, CTX, momentHasher)).toBeNull();
        }
      }),
      { numRuns: 1000 },
    );
  });
});
