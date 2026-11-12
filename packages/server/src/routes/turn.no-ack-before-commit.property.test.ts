// Feature: voice-writes (brief 012 wave B, task B1), Property 9, rules half: nothing is acknowledged before it
// commits (design section 7, 2.7, G17). Over sequences of allergy turns on `/api/turn` with random Fake_FastSlots
// answers (late ones included) and a commit that fails on some turns' first attempt (`testing/arb-rule-turns.ts`):
//   - a failed attempt's response carries no note at all;
//   - a note that says a rule was saved (the `ruleSaved` pointer, or the typed line "Saved as a hard rule.") names
//     an active rule in the committed `core/rules` that this turn made active and that depends on this turn's
//     Evidence;
//   - a note that says a rule was already saved or stays on names an active rule that was active before the turn;
//   - a note that says nothing beyond the listed rules is saved needs a subject in committed `noneConfirmed`;
//   - a note that asks a question, or says food stays filtered, needs a pending rule in committed `core/rules`.
// The notes are told apart by the design's own template words (2.7), not by the product's table.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type TurnTrace, runRuleSequence, sequenceArb, turnSpecArb } from "../testing/arb-rule-turns";

type Claim = "saved" | "already" | "kept" | "none" | "ask";

/** What a note claims, by the design's template words; null for any other note (a typed reply). */
function claimOf(text: string): Claim | null {
  if (/hard rule the owner just stated is saved|^Saved as a hard rule\.$/.test(text)) return "saved";
  if (/already saved/.test(text)) return "already";
  if (/stays on/.test(text)) return "kept";
  if (/^Saved: nothing beyond/.test(text)) return "none";
  if (/not yet clear|isn't on the list|check with you before suggesting food/i.test(text)) return "ask";
  return null;
}

function check(t: TurnTrace, what: string): number {
  for (const f of t.failed) expect(f?.notes ?? [], `${what}: a failed attempt carried notes`).toEqual([]);
  if (t.status !== 200) return 0;
  let n = 0;
  const before = new Map(t.rulesBefore.allergies.map((r) => [r.id, r]));
  for (const note of t.response.notes ?? []) {
    const claim = claimOf(note.text);
    if (claim === null) continue;
    n++;
    const after = t.rulesAfter;
    switch (claim) {
      case "saved":
        expect(
          after.allergies.some((r) => r.state === "active" && before.get(r.id)?.state !== "active" && t.evidenceId !== null && r.dependsOn.includes(`e:${t.evidenceId}`)),
          `${what}: "${note.text}" with no rule made active by this turn`,
        ).toBe(true);
        break;
      case "already":
      case "kept":
        expect(after.allergies.some((r) => r.state === "active" && before.get(r.id)?.state === "active"), `${what}: "${note.text}" with no earlier active rule`).toBe(true);
        break;
      case "none":
        expect(after.noneConfirmed.length, `${what}: "${note.text}" with nothing in noneConfirmed`).toBeGreaterThan(0);
        break;
      case "ask":
        expect(after.allergies.some((r) => r.state === "pending"), `${what}: "${note.text}" with no pending rule`).toBe(true);
        break;
    }
  }
  return n;
}

describe("Property 9 (route): nothing is acknowledged before it commits", () => {
  it("every route note names committed state", { timeout: 300_000 }, async () => {
    let claims = 0;
    const turn = fc.tuple(turnSpecArb, fc.boolean()).map(([s, f]) => ({ ...s, commitFails: f }));
    await fc.assert(
      fc.asyncProperty(sequenceArb(turn), async (seq) => {
        const trace = await runRuleSequence(seq);
        for (const [n, t] of trace.turns.entries()) claims += check(t, `turn ${n + 1} "${t.text}" (${JSON.stringify(t.spec)})`);
      }),
      { numRuns: 60 },
    );
    expect(claims).toBeGreaterThan(0);
  });
});
