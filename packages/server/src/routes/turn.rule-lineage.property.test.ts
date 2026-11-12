// Feature: voice-writes (brief 012 wave B, task B1), Property 8, route half for rules: every rule resolves through
// its span to Evidence text that matches (design section 7, 2.5, G37; contracts §1 KC03). After sequences of
// allergy turns on `/api/turn` (`testing/arb-rule-turns.ts`), for every rule in the committed `core/rules`:
//   - an active rule has a proof;
//   - a proof's Evidence exists, the quote equals the Evidence text at its offsets, the rule's root keys are root
//     keys of that Evidence, and the rule depends on it; a gazetteer code is named in the quote as whole words;
//   - a pending rule with no proof has no root keys and no dependencies.
import { type Evidence, lookupAllergen, rootKey, scanAliases } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { UID, evidenceText, runRuleSequence, sequenceArb } from "../testing/arb-rule-turns";

describe("Property 8 (route): rule lineage", () => {
  it("every rule's proof quotes its Evidence", { timeout: 300_000 }, async () => {
    let checked = 0;
    await fc.assert(
      fc.asyncProperty(sequenceArb(), async (seq) => {
        const trace = await runRuleSequence(seq);
        const rules = trace.turns.at(-1)!.rulesAfter;
        for (const r of rules.allergies) {
          const what = `${r.state} ${r.subjectId} ${r.code}`;
          if (r.proof === null) {
            expect(r.state, `${what}: an active rule with no proof`).toBe("pending");
            expect([r.rootKeys, r.dependsOn], `${what}: no proof but lineage`).toEqual([[], []]);
            continue;
          }
          checked++;
          const ev = (await trace.rig.store.get<Evidence>(UID, paths.evidence(UID, r.proof.eid)))?.data ?? null;
          expect(ev, `${what}: proof Evidence missing`).not.toBeNull();
          const text = evidenceText(ev);
          expect(text.slice(r.proof.start, r.proof.end), `${what}: quote`).toBe(r.proof.quote);
          const keys = new Set(ev!.fieldSlices.map((s) => rootKey(s, trace.rig.deps.hasher)));
          for (const k of r.rootKeys) expect(keys.has(k), `${what}: root key ${k} not of its Evidence`).toBe(true);
          expect(r.dependsOn, `${what}: depends on its Evidence`).toContain(`e:${r.proof.eid}`);
          if (r.code !== "unresolved") {
            const named = new Set([...lookupAllergen(r.proof.quote), ...scanAliases(r.proof.quote).map((h) => h.code)]);
            expect(named.has(r.code), `${what}: "${r.proof.quote}" doesn't name ${r.code}`).toBe(true);
          }
        }
      }),
      { numRuns: 60 },
    );
    expect(checked).toBeGreaterThan(0);
  });
});
