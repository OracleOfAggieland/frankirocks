// Feature: forget (brief 021), Property FP1: a hard rule outlives any forget (spec §8 "What survives"; contracts §8
// step 5, §7 reanchorRule; KV08). For any store and any forget target, through `planInstall`:
//   - every committed rule is still in `core/rules` afterwards, `active` or `pending`, never gone;
//   - an `active` rule with a proof points at Evidence that is not blocked by this forget, and its quote is
//     verbatim the text at its span (on the sanitized revision when it was re-anchored);
//   - a `pending` rule carries no name, no proof and no erased roots.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evidenceFieldText } from "../evidence";
import type { ID } from "../schema/primitives";
import type { CoreRules, Evidence } from "../schema/records";
import { planInstall } from "./install";
import { forgetStoreArb } from "./testing/arb-forget";

describe("FP1: a hard rule outlives any forget", () => {
  it("every rule stays active or pending, and a re-anchored quote is verbatim", () => {
    fc.assert(
      fc.property(forgetStoreArb, (st) => {
        const plan = planInstall(st.input);
        const evidence = new Map<ID, Evidence>(st.input.evidence);
        const blocked = new Set<ID>();
        let after: CoreRules = st.input.rules;
        for (const w of plan.writes) {
          if (w.collection === "evidence") {
            evidence.set(w.id, w.doc);
            if (w.doc.status === "blocked") blocked.add(w.id);
          }
          if (w.collection === "core") after = w.doc;
        }
        expect(after.allergies.length).toBeGreaterThanOrEqual(st.input.rules.allergies.length);
        for (const before of st.input.rules.allergies) {
          const rule = after.allergies.find((r) => r.id === before.id);
          expect(rule, `rule ${before.id} is gone`).toBeDefined();
          expect(["active", "pending"]).toContain(rule!.state);
          if (rule!.state === "pending" && before.state === "active") {
            expect(rule!.subjectId).toBeNull();
            expect(rule!.proof).toBeNull();
            expect(rule!.rootKeys).toEqual([]);
          }
          if (rule!.state === "active" && rule!.proof !== null) {
            expect(blocked.has(rule!.proof.eid), "an active rule points at blocked Evidence").toBe(false);
            const ev = evidence.get(rule!.proof.eid);
            expect(ev).toBeDefined();
            const text = evidenceFieldText(ev!, rule!.proof.fieldPath);
            expect(text?.slice(rule!.proof.start, rule!.proof.end)).toBe(rule!.proof.quote);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
