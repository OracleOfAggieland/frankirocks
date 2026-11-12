// Brief 039, property 3: allergies are untouched. For any inputs, the dinners removed for an allergy (and why) are
// the same with and without diets and dislikes stored. Brief 037's properties stay as they are.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NO_PREFS, foodPrefsOf } from "./prefs";
import { suggestFood } from "./suggest";
import { OTHER, ZONE, memoriesOf, prefCaseArb, wordsOfCase } from "./testing/pref-cases";

const ALLERGY = new Set(["rulesUnavailable", "unknownAllergen", "unknownRule", "rule", "mayContain"]);

describe("property 3: allergies are untouched", () => {
  it("the allergy removals are the same with and without diets and dislikes", () => {
    fc.assert(
      fc.property(prefCaseArb, fc.boolean(), fc.subarray(["self", OTHER]), (c, noRules, attendees) => {
        const rules = noRules ? null : c.rules;
        const prefs = foodPrefsOf({ memories: memoriesOf(c), at: c.at, zone: ZONE, applies: () => true, wordsOf: wordsOfCase(c) });
        const withPrefs = suggestFood({ rules, attendeeIds: attendees, prefs });
        const without = suggestFood({ rules, attendeeIds: attendees, prefs: NO_PREFS });
        const bare = suggestFood({ rules, attendeeIds: attendees });
        const allergic = (r: typeof bare) => r.filter.removed.filter((x) => ALLERGY.has(x.reason));
        expect(allergic(withPrefs)).toEqual(allergic(bare));
        expect(allergic(without)).toEqual(allergic(bare));
        // Nothing an allergy removed comes back, and the rules-unavailable line still wins.
        const removed = new Set(allergic(bare).map((x) => x.id));
        for (const d of withPrefs.candidates) expect(removed.has(d.id)).toBe(false);
        if (rules === null) expect(withPrefs.question).toBe(bare.question);
      }),
      { numRuns: 1000 },
    );
  });
});
