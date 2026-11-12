// Brief 032, property "Every alias in the owner's text has a slot" (finding H2). On a turn triggered by an RX4 cue,
// with any sentences before and after it, any FastSlots answer (careful items with any change, items dropped, an
// empty answer or none), either speaker certainty, and prior rules that name other codes: each gazetteer alias in the
// first cue sentence or any sentence after it ends the turn with a slot of its code, or under an `unresolved` filter.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { scanAliases } from "./gazetteer";
import { rx4Sentences, sentencesOf } from "./not-allergy";
import { NAMED } from "./testing/arb-hard-rule";
import { SELF, answerArb, answerFor, emptyRules, planTurn, unrelatedPriors } from "./testing/arb-review";
import { TURN_EID, spanAt } from "./testing/arb-writes";
import type { FastItem, Polarity } from "./types";

type Kind = "cue" | "cantHave" | "notCue" | "joke" | "too" | "also" | "order" | "past" | "filler";
const CUE_KINDS: readonly Kind[] = ["cue", "cantHave", "notCue", "joke"];
const OTHER_KINDS: readonly Kind[] = ["too", "also", "order", "past", "filler"];

function sentence(kind: Kind, a: string): { text: string; polarity: Polarity; names: boolean } {
  const A = `${a[0]!.toUpperCase()}${a.slice(1)}`;
  switch (kind) {
    case "cue":
      return { text: `I'm allergic to ${a}.`, polarity: "affirmed", names: true };
    case "cantHave":
      return { text: `My brother can't have ${a}, he's allergic.`, polarity: "affirmed", names: true };
    case "notCue":
      return { text: `I'm not allergic to ${a}.`, polarity: "denied", names: true };
    case "joke":
      return { text: "I'm allergic to Mondays.", polarity: "affirmed", names: false };
    case "too":
      return { text: `${A} too.`, polarity: "affirmed", names: true };
    case "also":
      return { text: `Oh, and ${a} as well.`, polarity: "affirmed", names: true };
    case "order":
      return { text: `Can you order ${a} for Friday?`, polarity: "affirmed", names: true };
    case "past":
      return { text: `We had ${a} last night.`, polarity: "affirmed", names: true };
    case "filler":
      return { text: "The weather was grey today.", polarity: "affirmed", names: false };
  }
}

const partArb = (kinds: readonly Kind[]) => fc.record({ kind: fc.constantFrom(...kinds), a: fc.constantFrom(...NAMED) });

const caseArb = fc.record({
  before: fc.array(partArb(OTHER_KINDS), { maxLength: 2 }),
  cue: partArb(CUE_KINDS),
  after: fc.array(partArb([...CUE_KINDS, ...OTHER_KINDS]), { maxLength: 3 }),
  answer: answerArb,
  speakerCertain: fc.boolean(),
  priors: fc.subarray([0, 1, 2, 3, 4]),
});

describe("Every alias in the owner's text has a slot (brief 032)", () => {
  it("each alias in the cue sentence or after it ends the turn with a slot or under the unresolved filter", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const parts = [...c.before, c.cue, ...c.after].map((p) => ({ ...p, ...sentence(p.kind, p.a) }));
        const text = parts.map((p) => p.text).join(" ");
        // The careful items: one per sentence that names an allergen, its own sentence as the span.
        let at = 0;
        const careful: FastItem[] = [];
        for (const p of parts) {
          const start = text.indexOf(p.text, at);
          at = start + p.text.length;
          if (!p.names) continue;
          careful.push({ kind: "allergy", subject: SELF, item: p.a, severity: "allergy", polarity: p.polarity, act: "direct", span: spanAt(TURN_EID, text, start, start + p.text.length - 1) });
        }
        const codes = new Set(scanAliases(text).map((h) => h.code));
        const rules = { ...emptyRules(), allergies: unrelatedPriors(codes, c.priors) };
        // Two picks per answer spec: the first two careful items may change; the rest go as they are.
        const head = answerFor(c.answer, careful.slice(0, 2), text);
        const out = head === null ? null : { ...head, items: [...head.items, ...careful.slice(2)] };
        const plan = planTurn(text, out, rules, c.speakerCertain);

        const first = rx4Sentences(text)[0]!;
        const scope = sentencesOf(text).filter((s) => s.start >= first.start);
        const unresolved = plan.rules.allergies.some((r) => r.code === "unresolved");
        for (const s of scope) {
          for (const hit of scanAliases(text, s.start, s.end)) {
            const slot = plan.rules.allergies.some((r) => r.code === hit.code);
            expect(slot || unresolved, `"${text}": ${hit.code} has no slot; answer ${JSON.stringify(out)}`).toBe(true);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
