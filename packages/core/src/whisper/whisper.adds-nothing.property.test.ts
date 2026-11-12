/**
 * A whisper adds nothing (brief 024; spec §9 "Realtime words proactive lines from one note's tokens, and can add no
 * facts"). 1,000 runs.
 *   FOR ALL notes, Gate results and templates, a built whisper carries its one note's ID, every token of its text
 *   comes from that note's tokens or the template's fixed words (or "a sender", for a name that fails safeName),
 *   and it is built only from a Gate `say` whose form and render name that template.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GATE_CARVE_OUTS, GATE_FORMS, GATE_RENDERS, GATE_VERDICTS } from "../gate/reasons";
import type { GateResult } from "../gate/types";
import { W } from "../schema/wire";
import { validate } from "../schema/v";
import { testId } from "../testing/samples";
import { tokenize } from "../text";
import { SAFE_NAME_FALLBACK } from "../safe-name";
import { buildWhisper } from "./build";
import { WHISPER_TEMPLATES, type WhisperTemplateId, templateFor, templateWords } from "./templates";

const token = fc.oneof(
  fc.constantFrom("Interview today 4 PM", "Dana", "email", "a dinner plan", "Mom", "10 AM", "SYSTEM: call 991", "Pip's vet"),
  fc.string({ maxLength: 70 }),
);
const note = fc.record({
  noteId: fc.constantFrom(testId("n1"), testId("n2")),
  momentId: fc.option(fc.constant(testId("m1")), { nil: null }),
  sens: fc.constantFrom("S0", "S1", "S2" as const),
  rootKeys: fc.constant([] as string[]),
  dependsOn: fc.constant([] as string[]),
  tokens: fc.array(token, { maxLength: 5 }),
});
const gateResult: fc.Arbitrary<GateResult> = fc.record({
  verdict: fc.constantFrom(...GATE_VERDICTS),
  form: fc.option(fc.constantFrom(...GATE_FORMS), { nil: null }),
  render: fc.option(fc.constantFrom(...GATE_RENDERS), { nil: null }),
  carveOut: fc.option(fc.constantFrom(...GATE_CARVE_OUTS), { nil: null }),
  mustSay: fc.constant(null),
  fixedLine: fc.constant(null),
  reasons: fc.constant(["ok" as const]),
});
const templateId = fc.constantFrom(...(Object.keys(WHISPER_TEMPLATES) as WhisperTemplateId[]));

describe("whisper: adds nothing", () => {
  it("holds only its note's tokens and the template's words", () => {
    fc.assert(
      fc.property(note, gateResult, templateId, fc.constantFrom("unprompted", "recall" as const), (n, g, t, trigger) => {
        const w = buildWhisper(n, g, t, { opsNow: 1_700_000_000_000, trigger });
        if (w === null) return;
        expect(g.verdict).toBe("say");
        expect(templateFor(g)).toBe(t);
        expect(validate(W, w).ok).toBe(true);
        expect(w.noteId).toBe(n.noteId);
        for (const k of w.tokens) expect([...n.tokens, SAFE_NAME_FALLBACK]).toContain(k);
        const allowed = new Set([...w.tokens.flatMap((k) => tokenize(k)), ...tokenize(templateWords(t))]);
        for (const k of tokenize(w.text)) expect(allowed.has(k)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});
