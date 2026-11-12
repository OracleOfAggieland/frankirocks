// Brief 032, property "Stated means filtered" (findings H1 and H2). For any owner's sentence that affirms an allergy
// to a gazetteer item, any FastSlots answer at all (wrong polarity, act, span or item, items missing, an empty answer
// with any `need`, or no answer: invalid or late), either speaker certainty, and prior rules that name other codes,
// the item is filtered for its subject after the turn: an active rule, a pending rule, or the unresolved filter, for
// that subject or for anyone. Never nothing.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SHAPES, allergenPairArb, answerArb, answerFor, emptyRules, filteredFor, planTurn, stated, unrelatedPriors } from "./testing/arb-review";
import { lookupAllergen } from "./gazetteer";

describe("Stated means filtered (brief 032)", () => {
  it("an affirmed allergy is filtered for its subject whatever the FastSlots answer", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SHAPES),
        allergenPairArb,
        answerArb,
        fc.boolean(),
        fc.subarray([0, 1, 2, 3, 4]),
        (shape, [a, b], spec, speakerCertain, picks) => {
          const s = stated(shape, a, b);
          const codes = new Set(lookupAllergen(s.allergen));
          const rules = { ...emptyRules(), allergies: unrelatedPriors(codes, picks) };
          const out = answerFor(spec, s.careful, s.text);
          const plan = planTurn(s.text, out, rules, speakerCertain);
          for (const code of codes) {
            expect(filteredFor(plan.rules, s.subject, code), `"${s.text}": ${code} not filtered for ${s.subject}; answer ${JSON.stringify(out)}`).toBe(true);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});
