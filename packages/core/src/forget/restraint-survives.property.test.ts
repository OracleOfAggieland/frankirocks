// Feature: forget (brief 021), Property FP3: restraint survives (spec §8 "What withdrawal keeps"; contracts §4
// registry note, §8 step 6). For any forget:
//   - through `planInstall`, every active exclude, quiet or care hold whose premises name no target is still
//     active with the same kind, target and scope, and every `wrong` Memory that was not a target stays `wrong`;
//   - through `planWithdrawal` of any row that was not the target, every active exclude, quiet or care hold it
//     premised keeps its restraint as a content-free `withdrawnHold` on the same target and scope, with no
//     premises, roots or dependencies, at a sensitivity no lower than before; a `wrong` Memory stays `wrong`.
// Cancelled moments have no schema on this branch (design note 021, gap 11); they are not generated.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Effect, HOLD_KINDS } from "../schema/records";
import { validate } from "../schema/v";
import { planInstall } from "./install";
import { forgetStoreArb, memoryRef } from "./testing/arb-forget";
import { planWithdrawal } from "./withdraw";

const SENS_ORDER = { S0: 0, S1: 1, S2: 2 } as const;
const isHold = (k: string) => (HOLD_KINDS as readonly string[]).includes(k);

describe("FP3: restraint survives", () => {
  it("install leaves every non-target restraint in force", () => {
    fc.assert(
      fc.property(forgetStoreArb, (st) => {
        const plan = planInstall(st.input);
        const targetIds = new Set(st.input.targets.map((t) => t.id));
        const written = new Map(plan.writes.filter((w) => w.collection === "effects").map((w) => [w.id, w.doc as Effect]));
        for (const { id, effect } of st.input.effects) {
          if (!isHold(effect.kind) || effect.state !== "active") continue;
          if (effect.premiseIds.some((p) => targetIds.has(p.id))) continue;
          const after = written.get(id) ?? effect;
          expect(after.state).toBe("active");
          expect(after.kind).toBe(effect.kind);
          expect(after.target).toEqual(effect.target);
          expect(after.scope).toEqual(effect.scope);
        }
        const memWrites = new Map(plan.writes.filter((w) => w.collection === "memories").map((w) => [w.id, w.doc]));
        for (const o of st.others) {
          if (o.memory.status !== "wrong") continue;
          const after = memWrites.get(o.id);
          if (after !== undefined) expect((after as { status: string }).status).toBe("wrong");
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("withdrawing a non-target row keeps its holds content-free", () => {
    fc.assert(
      fc.property(
        forgetStoreArb.filter((st) => st.others.length > 0),
        fc.nat(),
        (st, pick) => {
          const w = st.others[pick % st.others.length]!;
          const plan = planWithdrawal({
            opId: st.input.opId,
            stamps: st.input.stamps,
            now: st.input.now,
            withdrawn: memoryRef(w),
            memory: w.memory,
            effects: st.input.effects,
            hasher: st.input.hasher,
          });
          if (w.memory.status === "wrong") expect(plan.memory?.status).toBe("wrong");
          for (const { effect } of st.input.effects) {
            if (!isHold(effect.kind) || effect.state !== "active") continue;
            if (!effect.premiseIds.some((p) => p.type === "memory" && p.id === w.id)) continue;
            const hold = plan.holds.find(
              (h) => h.effect.holdKind === effect.kind && JSON.stringify(h.effect.target) === JSON.stringify(effect.target) && JSON.stringify(h.effect.scope) === JSON.stringify(effect.scope),
            );
            expect(hold, `no hold kept for a ${effect.kind}`).toBeDefined();
            const h = hold!.effect;
            expect(validate(Effect, h).ok).toBe(true);
            expect(h.kind).toBe("withdrawnHold");
            expect(h.state).toBe("active");
            expect(h.contentFree).toBe(true);
            expect(h.premiseIds).toEqual([]);
            expect(h.rootKeys).toEqual([]);
            expect(h.rootSlices).toEqual([]);
            expect(h.dependsOn).toEqual([]);
            expect(SENS_ORDER[h.minSens]).toBeGreaterThanOrEqual(SENS_ORDER[effect.minSens]);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});
