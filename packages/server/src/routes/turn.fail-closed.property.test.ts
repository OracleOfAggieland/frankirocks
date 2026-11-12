// Feature: voice-writes (brief 012 wave B, task B1), Property 4, route half: allergies fail closed on `/api/turn`
// (design section 7, 2.5, G3, G4, G19). Over sequences of typed and ASR allergy turns with random Fake_FastSlots and
// Fake Decisions answers (`testing/arb-rule-turns.ts`), for every turn RX4 matched or the parse made a hardRule
// candidate:
//   - `core/rules` records exactly one hardRule `handled` entry for the turn's Evidence;
//   - no active rule is ever removed;
//   - every gazetteer alias in the turn's cue sentences (the RX4 sentences, else the whole text) has its code in a
//     rule slot of the committed `core/rules`, or among the codes the entry records (a denial's);
//   - `noneConfirmed` gains a subject only on a speaker-certain turn (typed; or ASR with a committed parse, no
//     uncertain speaker and no company), and a pending rule leaves only for an active rule with its code or on such
//     a turn.
import { type CoreRules, rx4Sentences, scanAliases } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type TurnSpec, handledFor, runRuleSequence, sequenceArb } from "../testing/arb-rule-turns";

const certain = (s: TurnSpec) => s.source === "typed" || (!s.parseFails && s.uncertainSpeaker < 0.1 && !s.company);
const active = (r: CoreRules) => new Set(r.allergies.filter((x) => x.state === "active").map((x) => x.id));

describe("Property 4 (route): allergies fail closed", () => {
  it("every triggered turn ends in a slot, a denial or notAllergy, and nothing relaxes without a certain speaker", { timeout: 300_000 }, async () => {
    let triggered = 0;
    await fc.assert(
      fc.asyncProperty(sequenceArb(), async (seq) => {
        const trace = await runRuleSequence(seq);
        for (const [n, t] of trace.turns.entries()) {
          const what = `turn ${n + 1} "${t.text}" (${JSON.stringify(t.spec)})`;
          for (const id of active(t.rulesBefore)) expect(active(t.rulesAfter).has(id), `${what}: active rule ${id} removed`).toBe(true);
          const gained = t.rulesAfter.noneConfirmed.filter((s) => !t.rulesBefore.noneConfirmed.includes(s));
          if (gained.length > 0) expect(certain(t.spec), `${what}: noneConfirmed gained ${gained} on an uncertain turn`).toBe(true);
          for (const p of t.rulesBefore.allergies.filter((x) => x.state === "pending")) {
            if (t.rulesAfter.allergies.some((x) => x.id === p.id)) continue;
            const firmer = t.rulesAfter.allergies.some((x) => x.state === "active" && x.code === p.code && (p.subjectId === null || x.subjectId === p.subjectId));
            expect(firmer || certain(t.spec), `${what}: pending ${p.code} left on an uncertain turn`).toBe(true);
          }
          if (!t.triggered || t.status !== 200 || t.evidenceId === null) continue;
          triggered++;
          const entries = handledFor(t.rulesAfter, t.evidenceId).filter((h) => h.route === "hardRule");
          expect(entries.length, `${what}: hardRule handled entries`).toBe(1);
          const cue = t.regex ? rx4Sentences(t.text) : [{ start: 0, end: t.text.length }];
          const codes = cue.flatMap((s) => scanAliases(t.text, s.start, s.end).map((h) => h.code));
          const slots = new Set(t.rulesAfter.allergies.map((r) => r.code));
          const recorded = new Set(entries[0]!.ruleKeys.map((k) => k.code));
          for (const c of codes) expect(slots.has(c) || recorded.has(c), `${what}: ${c} has no slot and no denial`).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
    expect(triggered).toBeGreaterThan(0);
  });
});
