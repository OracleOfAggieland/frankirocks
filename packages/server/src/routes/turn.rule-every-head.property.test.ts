// Feature: voice-writes (brief 012 wave B, task B1), Property 3, route half: a rule, once active, is in every Head
// returned afterwards (design section 7, G1, G16, G25). Over sequences of allergy, denial, joke and ordinary turns
// with random Fake_FastSlots and Fake Decisions answers (`testing/arb-rule-turns.ts`), with a state poll after each
// turn:
//   - every Deck returned by `/api/turn` or `/api/session/state` after a rule's commit has `rulesRev` at or above that
//     commit's, and its Head's rules section reads the rule back (`readRulesSection`), as the owner's ("you") when
//     its subject is `self`;
//   - `bundle.rulesRev` equals `rules.rulesRev` after every turn;
//   - the set of active rule IDs never shrinks.
import { type CoreRules, allergenLabel, readRulesSection } from "@franki/core";

type AllergyRule = CoreRules["allergies"][number];
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runRuleSequence, sequenceArb } from "../testing/arb-rule-turns";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().trim();

describe("Property 3 (route): a rule is in every Head after its commit", () => {
  it("holds over turn sequences with state polls", { timeout: 300_000 }, async () => {
    let seen = 0;
    await fc.assert(
      fc.asyncProperty(sequenceArb(), async (seq) => {
        const trace = await runRuleSequence(seq);
        const committed = new Map<string, { rule: AllergyRule; rulesRev: number }>();
        for (const [n, t] of trace.turns.entries()) {
          const what = `turn ${n + 1} "${t.text}"`;
          expect(t.bundleAfter.rulesRev, `${what}: bundle.rulesRev`).toBe(t.rulesAfter.rulesRev);
          for (const id of committed.keys()) expect(t.rulesAfter.allergies.some((r) => r.id === id && r.state === "active"), `${what}: active ${id} gone`).toBe(true);
          for (const r of t.rulesAfter.allergies) if (r.state === "active" && !committed.has(r.id)) committed.set(r.id, { rule: r, rulesRev: t.rulesAfter.rulesRev });
          for (const deck of t.decks) {
            const triples = readRulesSection(deck.head.text);
            for (const { rule, rulesRev } of committed.values()) {
              seen++;
              expect(deck.rulesRev, `${what}: deck rulesRev`).toBeGreaterThanOrEqual(rulesRev);
              const label = norm(allergenLabel(rule.code) ?? "any food");
              const hit = triples.some((x) => x.state === "active" && norm(x.code) === label && (rule.subjectId !== "self" || norm(x.subject) === "you"));
              expect(hit, `${what}: ${rule.subjectId} ${rule.code} missing from the Head's rules: ${JSON.stringify(triples)}`).toBe(true);
            }
          }
        }
      }),
      { numRuns: 60 },
    );
    expect(seen).toBeGreaterThan(0);
  });
});
