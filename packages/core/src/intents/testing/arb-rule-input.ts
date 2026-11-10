/**
 * Server_Rule input generators for the seam property (voice-control R20.1, R20.5). Plain module.
 */
import fc from "fast-check";
import type { RuleInput, RuleParse } from "../../admission";
import { CONTROL_CLASSES, type ControlClass } from "../classes";
import { choose } from "../parse";

export const SOURCES = ["asr", "typed", "pasted", "tool"] as const;
export const TRANSCRIPTS = ["final", "missing", "failed"] as const;
export const JUDGES = ["O", "H", "U", "timeout", "error", "typed"] as const;
export const AUDIENCES = ["private", "company", "unknown"] as const;
export const NOTE_SENS = ["none", "S0", "S1+"] as const;
export const WAVES = ["A", "B"] as const;
export const FAIL_WHYS = ["deadline", "transport", "invalid", "oversize"] as const;

const arbCandidates: fc.Arbitrary<ControlClass[]> = fc.subarray([...CONTROL_CLASSES]);

/** A parse: ordinary, a hit whose `chosen` follows `choose`, failed, or none. */
export const arbRuleParse: fc.Arbitrary<RuleParse> = fc.oneof(
  fc.constant({ kind: "ordinary" } as const),
  fc.tuple(arbCandidates, fc.boolean()).filter(([c, u]) => c.length > 0 || u).map(([candidates, uncertain]) => ({ kind: "hit" as const, chosen: choose(candidates), candidates, uncertain })),
  fc.constantFrom(...FAIL_WHYS).map((why) => ({ kind: "failed" as const, why })),
  fc.constant({ kind: "none" } as const),
);

export const arbRuleInput: fc.Arbitrary<RuleInput> = fc.record({
  source: fc.constantFrom(...SOURCES),
  transcript: fc.constantFrom(...TRANSCRIPTS),
  judge: fc.constantFrom(...JUDGES),
  parse: arbRuleParse,
  regexMatch: fc.boolean(),
  audience: fc.constantFrom(...AUDIENCES),
  narrowedHere: fc.boolean(),
  callLive: fc.boolean(),
  parseGap: fc.boolean(),
  noteSens: fc.constantFrom(...NOTE_SENS),
  wordsPer2s: fc.boolean(),
  allFinal: fc.boolean(),
  toolParseCommitted: fc.boolean(),
  wave: fc.constantFrom(...WAVES),
});

/**
 * Every combination of the enum parts of RuleInput (source, transcript, judge, parse shape, audience, note level,
 * wave), with 14 parse shapes (ordinary, each class the rule names alone plus `food` for the rest, crisis with
 * company, uncertain only, each failure, none), under two boolean profiles: all false, and a live call with dense
 * final audio and a committed tool parse. The full product (1.7 M inputs) ran about 67 s, and 54 k inputs 5.5 s
 * under the full suite, past vitest's 5 s test timeout; the fast-check half of property 8 draws classes and
 * booleans freely.
 */
export function* allRuleInputs(): Generator<RuleInput> {
  const parses: RuleParse[] = [
    { kind: "ordinary" },
    // Each class the rule names on its own; `food` stands for the eight classes rule row 12 treats alike, which the
    // fast-check half covers in every subset.
    ...(["forget", "company", "quiet", "alone", "crisis", "food"] as const).map((c) => ({ kind: "hit" as const, chosen: c, candidates: [c], uncertain: false })),
    { kind: "hit", chosen: "company", candidates: ["crisis", "company"], uncertain: false },
    { kind: "hit", chosen: null, candidates: [], uncertain: true },
    ...FAIL_WHYS.map((why) => ({ kind: "failed" as const, why })),
    { kind: "none" },
  ];
  const profiles = [
    { regexMatch: false, narrowedHere: false, callLive: false, parseGap: false, wordsPer2s: false, allFinal: false, toolParseCommitted: false },
    { regexMatch: false, narrowedHere: false, callLive: true, parseGap: false, wordsPer2s: true, allFinal: true, toolParseCommitted: true },
  ];
  for (const source of SOURCES)
    for (const transcript of TRANSCRIPTS)
      for (const judge of JUDGES)
        for (const parse of parses)
          for (const audience of AUDIENCES)
            for (const noteSens of NOTE_SENS)
              for (const wave of WAVES) for (const b of profiles) yield { source, transcript, judge, parse, audience, noteSens, wave, ...b };
}
