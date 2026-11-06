// Property tests for the Look_Mapper (lab-ui-foundation design "Correctness Properties").
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbInput } from "../test-arbitraries";
import { isAvatarLook, lookFor } from "./look";

// Feature: lab-ui-foundation, Property 1: Look totality and determinism
describe("Property 1: Look totality and determinism", () => {
  it("returns one valid look for any input, equal on a deep copy", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const look = lookFor(input);
        expect(isAvatarLook(look)).toBe(true);
        expect(lookFor(structuredClone(input))).toEqual(look);
      }),
      { numRuns: 300 },
    );
  });
});
