/**
 * Server_Rule input generators for the seam property (voice-control R20.1, R20.5). Plain module.
 */
import fc from "fast-check";
import type { RuleInput, RuleParse } from "../../admission";
import { MEET_AGAIN_LINE, MEET_LINE } from "../../voice/lines";
import { CONTROL_CLASSES, type ControlClass } from "../classes";
import { choose } from "../parse";

export const SOURCES = ["asr", "typed", "pasted", "tool"] as const;
export const TRANSCRIPTS = ["final", "missing", "failed"] as const;
export const JUDGES = ["O", "H", "U", "timeout", "error", "typed"] as const;
export const AUDIENCES = ["private", "company", "unknown"] as const;
export const NOTE_SENS = ["none", "S0", "S1+"] as const;
export const WAVES = ["A", "B"] as const;
export const FAIL_WHYS = ["deadline", "transport", "invalid", "oversize"] as const;
/** Brief 052 ruling 5: the first meeting's two lines, the only values `meetLine` takes. */
export const MEET_LINES = [MEET_LINE, MEET_AGAIN_LINE] as const;

const arbCandidates: fc.Arbitrary<ControlClass[]> = fc.subarray([...CONTROL_CLASSES]);

/** A parse: ordinary, a hit whose `chosen` follows `choose`, failed, or none. */
export const arbRuleParse: fc.Arbitrary<RuleParse> = fc.oneof(
  fc.constant({ kind: "ordinary" } as const),
  fc
    .tuple(arbCandidates, fc.boolean(), fc.array(fc.constantFrom(0.2, 0.5, 0.79, 0.8, 0.99), { minLength: CONTROL_CLASSES.length, maxLength: CONTROL_CLASSES.length }))
    .filter(([c, u]) => c.length > 0 || u)
    .map(([candidates, uncertain, ps]) => ({ kind: "hit" as const, chosen: choose(candidates), candidates, uncertain, candidateP: Object.fromEntries(candidates.map((c, n) => [c, ps[n]!])) })),
  fc.constantFrom(...FAIL_WHYS).map((why) => ({ kind: "failed" as const, why })),
  fc.constant({ kind: "none" } as const),
);

const arbBaseRuleInput: fc.Arbitrary<RuleInput> = fc.record({
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

/** Brief 052 review F8: about one input in six carries a meet line, so the rule properties cover its row. */
export const arbRuleInput: fc.Arbitrary<RuleInput> = fc
  .tuple(arbBaseRuleInput, fc.oneof({ weight: 5, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: fc.constantFrom(...MEET_LINES) }))
  .map(([i, meetLine]) => (meetLine === null ? i : { ...i, meetLine }));

/**
 * Every combination of the enum parts of RuleInput (source, transcript, judge, parse shape, audience, note level,
 * wave), with 16 parse shapes (ordinary, each class the rule names alone at 0.9 plus `food` for the rest, forget and company
 * at 0.5, crisis with company, uncertain only, each failure, none), under two boolean profiles: all false, and a live call with dense
 * final audio and a committed tool parse. The full product (1.7 M inputs) ran about 67 s, and 54 k inputs 5.5 s
 * under the full suite, past vitest's 5 s test timeout; the fast-check half of property 8 draws classes and
 * booleans freely.
 *
 * Brief 052 review F8: then the meet line's row, each line over every source, transcript, parse shape and audience,
 * with and without a narrowed call, judge typed, note level none and wave B (a meet line's other fields never decide).
 */
export function* allRuleInputs(): Generator<RuleInput> {
  const parses: RuleParse[] = [
    { kind: "ordinary" },
    // Each class the rule names on its own; `food` stands for the eight classes rule row 12 treats alike, which the
    // fast-check half covers in every subset.
    // A sure candidate (0.9) for each, and a weak one (0.5) for the route classes the judge's O can stop (item 5).
    ...(["forget", "company", "quiet", "alone", "crisis", "food"] as const).map((c) => ({ kind: "hit" as const, chosen: c, candidates: [c], uncertain: false, candidateP: { [c]: 0.9 } })),
    ...(["forget", "company"] as const).map((c) => ({ kind: "hit" as const, chosen: c, candidates: [c], uncertain: false, candidateP: { [c]: 0.5 } })),
    { kind: "hit", chosen: "company", candidates: ["crisis", "company"], uncertain: false, candidateP: { crisis: 0.25, company: 0.9 } },
    { kind: "hit", chosen: null, candidates: [], uncertain: true, candidateP: {} },
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
  for (const meetLine of MEET_LINES)
    for (const source of SOURCES)
      for (const transcript of TRANSCRIPTS)
        for (const parse of parses)
          for (const audience of AUDIENCES)
            for (const narrowedHere of [false, true]) yield { source, transcript, judge: "typed", parse, audience, noteSens: "none", wave: "B", ...profiles[0]!, narrowedHere, meetLine };
}
