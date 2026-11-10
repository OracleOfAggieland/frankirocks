import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INTENT_NAMES } from "../classes";
import { arbP, arbProbabilities } from "./arb-intents";
import { AUDIENCES, JUDGES, NOTE_SENS, SOURCES, TRANSCRIPTS, WAVES, allRuleInputs, arbRuleInput } from "./arb-rule-input";

describe("intents and rule-input generators", () => {
  it("probabilities include the boundaries and stay in [0, 1]", () => {
    const ps = fc.sample(arbP, { numRuns: 2_000, seed: 3 });
    expect(ps).toContain(0.1999);
    expect(ps).toContain(0.2);
    expect(ps.every((p) => p >= 0 && p <= 1)).toBe(true);
    const v = fc.sample(arbProbabilities, { numRuns: 1, seed: 3 })[0]!;
    expect(Object.keys(v)).toEqual([...INTENT_NAMES]);
  });

  it("arbRuleInput covers every enum value and both waves", () => {
    const xs = fc.sample(arbRuleInput, { numRuns: 1_000, seed: 5 });
    const seen = (f: (x: (typeof xs)[number]) => string) => new Set(xs.map(f));
    expect(seen((x) => x.source)).toEqual(new Set(SOURCES));
    expect(seen((x) => x.transcript)).toEqual(new Set(TRANSCRIPTS));
    expect(seen((x) => x.judge)).toEqual(new Set(JUDGES));
    expect(seen((x) => x.audience)).toEqual(new Set(AUDIENCES));
    expect(seen((x) => x.noteSens)).toEqual(new Set(NOTE_SENS));
    expect(seen((x) => x.wave)).toEqual(new Set(WAVES));
    expect(seen((x) => x.parse.kind)).toEqual(new Set(["ordinary", "hit", "failed", "none"]));
  });

  it("the enum-only part enumerates exhaustively", () => {
    let n = 0;
    for (const _ of allRuleInputs()) n++;
    // 4 sources × 3 transcripts × 6 judges × 21 parses × 3 audiences × 3 note levels × 2 waves × 2^6 booleans
    expect(n).toBe(4 * 3 * 6 * 21 * 3 * 3 * 2 * 2 ** 6);
  });
});
