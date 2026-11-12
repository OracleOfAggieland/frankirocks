/**
 * A whisper belongs to its candidate (brief 033 property 6, finding 6, the core half; spec §2 "Whisper": one note,
 * one Gate-approved candidate). 1,000 runs.
 *   FOR ALL candidates, contexts and notes, a whisper is built from a Gate result only when the note names the
 *   candidate the Gate decided on and carries its sensitivity; a note for another candidate, or one that claims a
 *   different sensitivity, builds nothing.
 * The Deck half (`withWhispers` drops what the audience may not hear) is in packages/server.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gate } from "../gate/gate";
import { candidateArb, contextArb } from "../gate/testing/arb";
import { testId } from "../testing/samples";
import { buildWhisper } from "./build";
import { templateFor } from "./templates";

const note = fc.record({
  candidateId: fc.constantFrom(testId("cand-1"), testId("cand-2")),
  sens: fc.constantFrom("S0", "S1", "S2" as const),
  tokens: fc.constantFrom(["Mom biopsy came back positive"], ["Dana", "email"], ["Dentist", "starts", "3 PM"], ["10"], ["Mom"], [] as string[]),
});

describe("whisper: belongs to its candidate", () => {
  it("builds nothing from a note for another candidate or sensitivity", () => {
    fc.assert(
      fc.property(candidateArb, contextArb, note, (c, x, n) => {
        const g = gate(c, x);
        const t = templateFor(g);
        if (g.verdict !== "say" || t === null) return;
        const w = buildWhisper({ noteId: testId("n1"), momentId: null, rootKeys: [], dependsOn: [], ...n }, g, t, { opsNow: 1_700_000_000_000, trigger: x.trigger });
        if (n.candidateId !== c.id || n.sens !== c.sens) expect(w).toBeNull();
        if (w !== null) expect(w.sens).toBe(c.sens);
      }),
      { numRuns: 1000 },
    );
  });
});
