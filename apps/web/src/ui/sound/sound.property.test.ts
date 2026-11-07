import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LOOK_NAMES } from "../avatar/look";
import type { LookName } from "../avatar/types";
import { type SoundGate, type SoundTrack, initialSoundTrack, scheduleCues } from "./schedule";
import { CUES, type Cue, scoreFor } from "./score";

// Feature: lab-ui-foundation, Property 15: Sound plays only when allowed
describe("Property 15: Sound plays only when allowed", () => {
  const arbGate: fc.Arbitrary<SoundGate> = fc.record({ gestured: fc.boolean(), soundOn: fc.boolean(), outputMuted: fc.boolean() });
  const arbStep = fc.record({
    name: fc.constantFrom<LookName>(...LOOK_NAMES, "Thinking", "Thinking", "Waking"),
    gap: fc.integer({ min: 0, max: 700 }),
    cardArrived: fc.boolean(),
    receiptShown: fc.boolean(),
    gate: arbGate,
  });

  it("cues only through an open gate, wake only on entering Waking, thinking once per long Thinking period", () => {
    fc.assert(
      fc.property(fc.array(arbStep, { minLength: 1, maxLength: 60 }), (steps) => {
        let track: SoundTrack = initialSoundTrack;
        let at = 0;
        let periodStart = 0;
        let thinkingInPeriod = 0;
        for (const s of steps) {
          at += s.gap;
          const prevName = track.name;
          const { track: next, cues } = scheduleCues(track, { name: s.name, at }, { cardArrived: s.cardArrived, receiptShown: s.receiptShown }, s.gate);
          const entered = s.name !== prevName;
          if (entered) {
            periodStart = at;
            thinkingInPeriod = 0;
          }
          if (cues.length > 0) expect(s.gate.gestured && s.gate.soundOn && s.gate.outputMuted).toBe(true);
          if (cues.includes("wake")) expect(entered && s.name === "Waking").toBe(true);
          if (cues.includes("thinking")) {
            expect(s.name).toBe("Thinking");
            expect(at - periodStart).toBeGreaterThan(1000);
            thinkingInPeriod++;
            expect(thinkingInPeriod).toBeLessThanOrEqual(1);
          }
          track = next;
        }
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: lab-ui-foundation, Property 16: Cue scores stay quiet and short
describe("Property 16: Cue scores stay quiet and short", () => {
  it("every note is audible but at most 0.25, with positive length and non-negative start; wake ends before 1.5 s", () => {
    fc.assert(
      fc.property(fc.constantFrom<Cue>(...CUES), (cue) => {
        const notes = scoreFor(cue);
        expect(notes.length).toBeGreaterThan(0);
        for (const n of notes) {
          expect(n.peakGain).toBeGreaterThan(0);
          expect(n.peakGain).toBeLessThanOrEqual(0.25);
          expect(n.durMs).toBeGreaterThan(0);
          expect(n.startMs).toBeGreaterThanOrEqual(0);
        }
        if (cue === "wake") expect(Math.max(...notes.map((n) => n.startMs + n.durMs))).toBeLessThan(1500);
      }),
      { numRuns: 100 },
    );
  });
});
