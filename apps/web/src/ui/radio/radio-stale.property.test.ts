// Property (brief 047, ui.radio): a player report naming an older tune never changes the state, whatever ran before.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { radioStep } from "./radio-machine";
import { moveArb, run, stationsArb } from "./testing/radio-arbitraries";

const REPORTS = ["playing", "waiting", "failed", "blocked", "timedOut"] as const;

describe("ui.radio property", () => {
  it("drops a stale player report", () => {
    fc.assert(
      fc.property(stationsArb(), fc.array(moveArb, { maxLength: 40 }), fc.integer({ min: 1, max: 5 }), fc.constantFrom(...REPORTS), (stations, moves, back, report) => {
        for (const s of run(moves, stations)) {
          expect(radioStep(s, { kind: "player", tune: s.tune - back, report }, stations)).toEqual(s);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
