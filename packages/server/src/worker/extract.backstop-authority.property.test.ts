// Feature: voice-writes (brief 012 wave B, task B8), Property 1, worker variant: the extraction backstop never
// proposes from text that isn't the owner's own (design section 7, G18). Over Evidence split into slices of random
// classes (U, T, M, O, C) and allergy items extraction might return (any act, "self" or a mention, a gazetteer code
// or not, spans that quote exactly or not, on any slice), `backstopProposal`:
//   - proposes nothing when no slice is U;
//   - installs only pending rules, each from an item all of whose spans verify on U slices, never active;
//   - gives a proof only on a U slice, quoting the Evidence at its offsets and naming the rule's code;
//   - installs nothing for a (subject, code) the route already handled.
import { type Class, type Span, type TurnEvidence, backstopProposal, buildSlice, lookupAllergen, rootKey, scanAliases, spanClass, verifyTurnSpan } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testRig } from "../testing/fakes";

const H = testRig().deps.hasher;
const EID = "e".repeat(43);
const SENTENCES = ["I'm allergic to shellfish.", "My friend can't have peanuts.", "She said kiwi makes her itch.", "We ate sesame noodles.", "No milk for me, please.", "I love cashew nuts."];
const CODES = ["shellfish", "peanut", "kiwi", "sesame", "milk", "cashew", "durian", "mondays"];
const ACTS = ["statement", "rule", "hard_rule", "joke", "quote", "hypothetical", "intention"];

const evidenceArb = fc
  .record({
    parts: fc.array(fc.tuple(fc.constantFrom(...SENTENCES), fc.constantFrom<Class>("U", "T", "M", "O", "C")), { minLength: 1, maxLength: 4 }),
  })
  .map(({ parts }): TurnEvidence => {
    let text = "";
    const ranges: { start: number; end: number; cls: Class }[] = [];
    for (const [s, cls] of parts) {
      const start = text.length === 0 ? 0 : text.length + 1;
      text = text.length === 0 ? s : `${text} ${s}`;
      ranges.push({ start, end: text.length, cls });
    }
    // Slices cover the text: each sentence's slice runs to the next one's start.
    const slices = ranges.map((r, i) => buildSlice({ eid: EID, fieldPath: "text", fieldText: text, start: r.start, end: i + 1 < ranges.length ? ranges[i + 1]!.start : text.length, class: r.cls, sens: "S0" }, H));
    return { eid: EID, rev: 1, text, slices, rootKeys: slices.map((s) => rootKey(s, H)), assertedAt: "2026-11-10T18:00:00.000Z" };
  });

const spanArb = (ev: TurnEvidence) =>
  fc.tuple(fc.nat(Math.max(0, ev.text.length - 1)), fc.integer({ min: 1, max: 30 }), fc.boolean()).map(([start, len, exact]): Span => {
    const end = Math.min(ev.text.length, start + len);
    const quote = ev.text.slice(start, end);
    return { eid: EID, fieldPath: "text", start, end, quote: exact ? quote : `${quote}x` };
  });

const caseArb = evidenceArb.chain((ev) =>
  fc.record({
    ev: fc.constant(ev),
    items: fc.array(fc.record({ act: fc.constantFrom(...ACTS), subject: fc.constantFrom("self", "m1"), allergenCode: fc.constantFrom(...CODES), spans: fc.array(spanArb(ev), { minLength: 1, maxLength: 3 }) }), { maxLength: 6 }),
    handled: fc.array(fc.record({ subjectId: fc.constantFrom<string | null>("self", null), code: fc.constantFrom(...CODES) }), { maxLength: 3 }),
  }),
);

describe("Property 1 (worker): the backstop never proposes from text that isn't the owner's", () => {
  it("holds for random slices, items and handled keys", () => {
    fc.assert(
      fc.property(caseArb, ({ ev, items, handled }) => {
        const p = backstopProposal(ev, items, handled, null, H);
        if (!ev.slices.some((s) => s.class === "U")) expect(p).toBeNull();
        if (p === null) return;
        expect(p.origin).toBe("backstop");
        const onU = (s: Span) => {
          const v = verifyTurnSpan(s, ev);
          return v !== null && spanClass(v, ev) === "U";
        };
        for (const r of p.install) {
          expect(r.state).toBe("pending");
          expect(handled.some((h) => h.subjectId === (r.anonymous ? null : r.subjectId) && h.code === r.code), `handled ${r.code}`).toBe(false);
          const from = items.filter((it) => it.spans.every(onU));
          expect(from.length, `rule ${r.code} from no U item`).toBeGreaterThan(0);
          if (r.proof !== null) {
            expect(onU(r.proof)).toBe(true);
            expect(ev.text.slice(r.proof.start, r.proof.end)).toBe(r.proof.quote);
            if (r.code !== "unresolved") expect(new Set([...lookupAllergen(r.proof.quote), ...scanAliases(r.proof.quote).map((h) => h.code)]).has(r.code)).toBe(true);
          } else expect([r.rootKeys, r.dependsOn]).toEqual([[], []]);
        }
      }),
      { numRuns: 2_000 },
    );
  });
});
