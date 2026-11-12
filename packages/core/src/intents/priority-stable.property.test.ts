// Feature: voice-control, Property 9: Priority is stable (R20.1.9; R10.2, R10.6, R10.7, R12.1).
// For any probability vector: the candidates are exactly the classes at or above 0.20; the chosen class is the
// first candidate in PRIORITY, or none; the ordinary test does not read the regex; and with crisis retained the
// Server_Rule gives the care reply whatever is chosen. A regex match never selects a route.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type RuleInput, serverRule } from "../admission";
import { CANDIDATE_P, CONTROL_CLASSES, PRIORITY } from "./classes";
import { candidates, choose, isOrdinary, outcomeOf } from "./parse";
import { arbProbabilities } from "./testing/arb-intents";

const base: Omit<RuleInput, "parse"> = {
  source: "asr",
  transcript: "final",
  judge: "O",
  regexMatch: false,
  audience: "private",
  narrowedHere: false,
  callLive: true,
  parseGap: false,
  noteSens: "none",
  wordsPer2s: true,
  allFinal: true,
  toolParseCommitted: false,
  wave: "A",
};

describe("Property 9: priority is stable", () => {
  it("candidates, choice, ordinary and the crisis reply follow the probabilities alone", () => {
    fc.assert(
      fc.property(arbProbabilities, fc.boolean(), fc.constantFrom<"A" | "B">("A", "B"), (p, regexMatch, wave) => {
        const cands = candidates(p);
        expect(cands).toEqual(CONTROL_CLASSES.filter((c) => p[c] >= CANDIDATE_P));
        const chosen = choose(cands);
        expect(chosen).toBe(PRIORITY.find((c) => p[c] >= CANDIDATE_P) ?? null);
        expect(isOrdinary(p)).toBe(cands.length === 0 && p.uncertainSpeaker < 0.1);
        const parse = outcomeOf(p);
        const withRegex = serverRule({ ...base, wave, parse, regexMatch });
        expect(withRegex).toEqual(serverRule({ ...base, wave, parse, regexMatch: !regexMatch }));
        if (parse.kind === "ordinary") expect(withRegex).toMatchObject({ kind: "permit", permit: "slowOrdinary", line: null });
        if (cands.includes("crisis")) expect(serverRule({ ...base, wave, callLive: false, parse })).toMatchObject({ kind: "permit", permit: "postCommitControl", scope: "ack", notes: "none", line: null });
      }),
      { numRuns: 1_000 },
    );
  });
});
