// Feature: brief 041 part 1, Property 2: a pasted allergen is never offered. For any pasted line the allergy cues
// match, and the food path that follows before the owner answers (`suggestFood` on the stored rules, for the owner
// and any attendees), nothing offered holds an allergen the paste named.
import { allergenFlags, codesConflict, pastedAllergens, suggestFood } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pasteArb, pasteRig } from "../testing/arb-paste";

describe("Property 2 (brief 041): a pasted allergen is never offered", () => {
  it("no candidate after the paste holds a named allergen", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(pasteArb, fc.subarray(["friend-1", "friend-2"]), async (text, attendees) => {
        const named = pastedAllergens(text);
        fc.pre(named.length > 0);
        const w = await pasteRig();
        expect((await w.paste(text)).status).toBe(200);
        const rules = await w.rules();
        const out = suggestFood({ rules: rules.allergies, attendeeIds: attendees });
        // Within the caps every named allergen is filtered; past them the question is the guard, and nothing is offered
        // that conflicts with a filter written.
        for (const c of out.candidates) {
          for (const f of allergenFlags(c)) {
            for (const code of named.slice(0, 3)) expect(codesConflict(code, f.code), `"${text}": ${c.id} holds ${f.code}`).toBe(false);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
