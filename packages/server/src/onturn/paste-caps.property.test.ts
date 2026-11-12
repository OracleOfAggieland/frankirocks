// Feature: brief 041 part 1, Property 3: the caps hold. For any sequence of pastes, the open pending filters from
// pastes never exceed `PASTE_FILTERS_OPEN_MAX`, one paste writes at most `PASTE_FILTERS_MAX`, and nothing in a pending
// filter or the Head's question carries a word of the pasted text other than the allergen's own label from the code
// list (the filter has no proof Span; the question is a code template).
import { PASTE_FILTERS_MAX, PASTE_FILTERS_OPEN_MAX, allergenLabel, fromPaste, gazetteerEntry, pasteQuestion } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pasteArb, pasteRig, wordsOf } from "../testing/arb-paste";

const TEMPLATE = wordsOf(pasteQuestion("egg").replace(/eggs/i, ""));

describe("Property 3 (brief 041): the caps hold", () => {
  it("open paste filters stay within the caps and carry no pasted words", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(pasteArb, { minLength: 1, maxLength: 5 }), async (pastes) => {
        const w = await pasteRig();
        let open = 0;
        for (const t of pastes) {
          expect((await w.paste(t)).status).toBe(200);
          const rules = await w.rules();
          const now = rules.allergies.filter(fromPaste);
          expect(now.length - open, `"${t}" wrote ${now.length - open}`).toBeLessThanOrEqual(PASTE_FILTERS_MAX);
          expect(now.length, `${JSON.stringify(pastes)}: ${now.length} open`).toBeLessThanOrEqual(PASTE_FILTERS_OPEN_MAX);
          open = now.length;
          for (const r of now) {
            expect(r.proof).toBeNull();
            expect(gazetteerEntry(r.code)).not.toBeNull();
          }
          const head = (await w.bundle()).head?.text ?? "";
          const line = head.split("\n").find((l) => l.startsWith("Open question"));
          if (line !== undefined) {
            const labels = new Set(now.flatMap((r) => [...wordsOf(allergenLabel(r.code) ?? r.code)]));
            for (const word of wordsOf(line)) expect(TEMPLATE.has(word) || labels.has(word) || ["open", "question", "ask", "once"].includes(word), `"${line}" carries "${word}"`).toBe(true);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
