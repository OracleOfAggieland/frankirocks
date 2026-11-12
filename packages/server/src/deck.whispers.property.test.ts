/**
 * A whisper on the Deck is one its audience may hear (brief 033 property 6, finding 6, the Deck half; spec §6
 * "Company: S1+ and third-party facts held, doors off, a narrower deck issued"; spec §3 "S1+ notes never sit on the
 * deck"). 1,000 runs.
 *   FOR ALL Decks already holding whispers, new whispers with their templates, and audiences, the Deck that
 *   `withWhispers` returns carries only S0 whispers that `audienceMayHear` allows for that audience; a whisper the
 *   Deck already held, whose template is unknown, stays only while the audience is private.
 */
import { type Deck, type GatedWhisper, type W, type WhisperTemplateId, WHISPER_TEMPLATES, audienceMayHear, tsFromMs } from "@franki/core";
import { sampleHead, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { issueDeck, withWhispers } from "./deck";

const OPS = Date.parse("2026-11-12T17:00:00.000Z");

const whisper = (n: number, sens: W["sens"]): W => ({
  noteId: testId(`n${n}`),
  rev: 1,
  kind: "truth",
  text: "Pip. One line, no recap.",
  rootKeys: [],
  dependsOn: [],
  sens,
  expiresAt: tsFromMs(OPS + 30_000),
  unprompted: true,
  momentId: null,
  tokens: ["Pip"],
});
const sens = fc.constantFrom("S0", "S1", "S2" as const);
const template = fc.constantFrom(...(Object.keys(WHISPER_TEMPLATES) as WhisperTemplateId[]));
const gated: fc.Arbitrary<GatedWhisper> = fc.record({ n: fc.nat(5), sens, template }).map((g) => ({ w: whisper(g.n, g.sens), template: g.template }));
const held = fc.array(fc.record({ n: fc.integer({ min: 10, max: 13 }), sens }), { maxLength: 4 }).map((a) => a.map((h) => whisper(h.n, h.sens)));

describe("deck: whispers only for the audience in the room", () => {
  it("drops what the audience may not hear, new or already held", () => {
    fc.assert(
      fc.property(held, fc.array(gated, { maxLength: 5 }), fc.constantFrom("private", "company", "unknown" as const), (old, notes, audience) => {
        const base: Deck = { ...issueDeck({ sessionId: testId("s"), epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1 }, sampleHead(), OPS), whispers: old };
        const d = withWhispers(base, notes, OPS, audience);
        for (const w of d.whispers) {
          expect(w.sens).toBe("S0");
          const fresh = notes.filter((g) => g.w === w);
          if (fresh.length > 0) expect(fresh.some((g) => audienceMayHear(g, audience))).toBe(true);
          else expect(audience).toBe("private");
        }
      }),
      { numRuns: 1000 },
    );
  });
});
