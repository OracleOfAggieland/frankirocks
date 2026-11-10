/**
 * Probability-vector generators for the priority property (voice-control R20.1, R20.5). Plain module.
 */
import fc from "fast-check";
import { INTENT_NAMES } from "../classes";
import type { Probabilities } from "../parse";

/** A probability, with the 0.20 and 0.10 boundaries and the ends weighted in. */
export const arbP: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.double({ min: 0, max: 1, noNaN: true }) },
  { weight: 2, arbitrary: fc.constantFrom(0, 1, 0.2, 0.1999, 0.1, 0.0999) },
  { weight: 2, arbitrary: fc.double({ min: 0, max: 0.19, noNaN: true }) },
);

export const arbProbabilities: fc.Arbitrary<Probabilities> = fc
  .array(arbP, { minLength: INTENT_NAMES.length, maxLength: INTENT_NAMES.length })
  .map((ps) => Object.fromEntries(INTENT_NAMES.map((n, i) => [n, ps[i]!])) as Probabilities);
