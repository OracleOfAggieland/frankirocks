// Feature: voice-writes (brief 012), Property 4c: an answer that names something the gazetteer doesn't know never
// takes the asked rule's code (design 2.4 answering rules 1 and 3, row A9; CQ 156). P4b (committed) counts only
// gazetteer codes in an answer's span, so a denial of "durian" passes it vacuously. This file checks, through
// `validateItems` then `planHardRule`, on the answering turns of `answerTurnArb`:
//   - an allergy item whose `item` is found in its own span, is not made of reference words alone ("it", "that",
//     "yes", "no"), and whose span names no gazetteer code, never gives a verdict carrying the asked rule's code,
//     and never a denial that answers the asked rule;
//   - when every allergy item of the turn is such an item, an asked pending rule with a gazetteer code stays.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { REGEX_TABLE, normalizeForRegex } from "../intents/regex";
import { planHardRule } from "./hard-rule";
import { TURN_AT, TURN_EID, buildEvidence, hardRuleTurn, validateContext } from "./testing/arb-writes";
import { answerTurnArb } from "./testing/arb-hard-rule-answers";
import { ORACLE_GAZETTEER, hasWholeWords } from "./testing/gazetteer-oracle";
import type { FastItem, ItemVerdict } from "./types";
import { validateItems } from "./validate";

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;

/** Words that only point back or answer, written out again. */
const REFERENCE = new Set(["it", "that", "this", "these", "those", "them", "one", "ones", "the", "same", "yes", "yeah", "yep", "yup", "no", "nope", "nah"]);

const codesIn = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const [code, e] of Object.entries(ORACLE_GAZETTEER)) {
    if (code === "none") continue;
    if (e.aliases.some((a) => hasWholeWords(text, a))) out.add(code);
  }
  return out;
};

/** An item that names something of its own the gazetteer doesn't know. */
function offTable(it: FastItem): it is Extract<FastItem, { kind: "allergy" }> {
  if (it.kind !== "allergy") return false;
  const words = it.item.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length === 0 || words.every((w) => REFERENCE.has(w))) return false;
  if (!hasWholeWords(it.span.quote, it.item)) return false;
  if (codesIn(it.item).size > 0 || codesIn(it.span.quote).size > 0) return false;
  return !hasWholeWords(it.span.quote, "nothing") && !hasWholeWords(it.span.quote, "anything");
}

function carriedCodes(v: ItemVerdict): string[] {
  if (v.kind === "ignored") return "codes" in v ? v.codes : [];
  if (v.kind !== "allergy") return [];
  const a = v.v;
  if (a.kind === "affirm") return a.codes;
  if (a.kind === "unsure") return a.codes === "unresolved" ? [] : a.codes;
  if (a.kind === "deny" && "codes" in a) return a.codes;
  return [];
}

describe("Property 4c: an answer naming something off the table never takes the asked rule's code", () => {
  it("holds on every answering turn, whatever the asked rule and the items", () => {
    const seen = { offTable: 0, allOff: 0 };
    fc.assert(
      fc.property(answerTurnArb, (g) => {
        const R = g.answering?.rule ?? null;
        fc.pre(R !== null && g.out !== null);
        const evidence = buildEvidence(TURN_EID, g.text, [], ["U"], TURN_AT);
        const trigger = { regex: RX4.test(normalizeForRegex(g.text)), candidate: g.candidate, asked: true };
        const ctx = validateContext(evidence, { routes: new Set(["hardRule"]), speakerCertain: g.speakerCertain, answering: g.answering });
        const verdicts = validateItems(g.out!, ctx);
        const plan = planHardRule(g.rules, verdicts, hardRuleTurn(evidence, g.out, { trigger, speakerCertain: g.speakerCertain, answering: g.answering }));

        for (const v of verdicts) {
          const item = g.out!.items[v.index]!;
          if (!offTable(item)) continue;
          seen.offTable++;
          if (R!.code !== "unresolved") expect(carriedCodes(v), `"${item.item}" in "${g.text}" took the asked ${R!.code}`).not.toContain(R!.code);
          const answers = v.kind === "allergy" && v.v.kind === "deny" && "answers" in v.v;
          expect(answers, `a denial of "${item.item}" in "${g.text}" answered the asked rule`).toBe(false);
        }

        const allergyItems = g.out!.items.filter((it) => it.kind === "allergy");
        if (allergyItems.length > 0 && allergyItems.every(offTable) && R!.state === "pending" && R!.code !== "unresolved") {
          seen.allOff++;
          expect(plan.rules.allergies.some((r) => r.id === R!.id), `asked ${R!.code} left on "${g.text}"`).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
    expect(seen.offTable).toBeGreaterThan(0);
    expect(seen.allOff).toBeGreaterThan(0);
  });
});
