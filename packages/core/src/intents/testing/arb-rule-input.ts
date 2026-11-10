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
 * Every combination of the enum-only part of RuleInput, with the parse drawn from a fixed list of shapes (ordinary,
 * one hit per class alone, crisis with company, uncertain only, each failure, none) and every boolean.
 */
export function* allRuleInputs(): Generator<RuleInput> {
  const parses: RuleParse[] = [
    { kind: "ordinary" },
    ...CONTROL_CLASSES.map((c) => ({ kind: "hit" as const, chosen: c, candidates: [c], uncertain: false })),
    { kind: "hit", chosen: "company", candidates: ["crisis", "company"], uncertain: false },
    { kind: "hit", chosen: null, candidates: [], uncertain: true },
    ...FAIL_WHYS.map((why) => ({ kind: "failed" as const, why })),
    { kind: "none" },
  ];
  const bools = [false, true];
  for (const source of SOURCES)
    for (const transcript of TRANSCRIPTS)
      for (const judge of JUDGES)
        for (const parse of parses)
          for (const audience of AUDIENCES)
            for (const noteSens of NOTE_SENS)
              for (const wave of WAVES)
                for (const regexMatch of bools)
                  for (const narrowedHere of bools)
                    for (const callLive of bools)
                      for (const parseGap of bools)
                        for (const dense of bools)
                          for (const toolParseCommitted of bools)
                            yield { source, transcript, judge, parse, regexMatch, audience, narrowedHere, callLive, parseGap, noteSens, wordsPer2s: dense, allFinal: dense, toolParseCommitted, wave };
}
