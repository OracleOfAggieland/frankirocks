// Property tests for the Look_Mapper (lab-ui-foundation design "Correctness Properties").
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AvatarState } from "@franki/core";
import { AVATAR_LABELS } from "../copy";
import { arbEvent, arbInput } from "../test-arbitraries";
import { isAvatarLook, lookFor } from "./look";
import type { AvatarInput, LookName } from "./types";

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

// Feature: lab-ui-foundation, Property 2: Fixed priority order
describe("Property 2: Fixed priority order", () => {
  const DURATION: Record<string, number> = { wake: 1200, "present-card": 800, celebrate: 1600 };
  /** Oracle written directly from the design's priority table. */
  function oracle(i: AvatarInput): LookName {
    const elapsed = Number.isFinite(i.eventElapsedMs) && i.eventElapsedMs > 0 ? i.eventElapsedMs : 0;
    const ev = i.event !== null && i.event !== "await-approval" && elapsed >= DURATION[i.event] ? null : i.event;
    if (i.state === "recovery") return "Recovery";
    if (i.state === "closed") return "Dormant";
    if (ev === "wake" || (i.state === "connecting" && i.firstConnecting)) return "Waking";
    if (ev === "celebrate") return "Celebrate";
    if (ev === "present-card") return "Presenting";
    if (ev === "await-approval") return "Awaiting_Approval";
    if (i.state === "connecting") return "Connecting";
    if (i.state === "listening") return "Listening";
    if (i.state === "thinking") return "Thinking";
    return i.outputMuted ? "Thinking" : "Speaking";
  }
  const label = (i: AvatarInput) => (i.state === "speaking" && i.outputMuted ? AVATAR_LABELS.thinking : AVATAR_LABELS[i.state]);
  const weighted = fc.oneof(
    { arbitrary: arbInput, weight: 2 },
    { arbitrary: fc.tuple(arbInput, fc.constantFrom<AvatarState>("recovery", "closed"), arbEvent).map(([i, state, event]) => ({ ...i, state, event })), weight: 1 },
  );

  it("names the look by the priority table and labels it by the state", () => {
    fc.assert(
      fc.property(weighted, (input) => {
        const look = lookFor(input);
        expect(look.name).toBe(oracle(input));
        expect(look.label).toBe(label(input));
        if (input.state === "recovery") expect(look.name).toBe("Recovery");
        if (input.state === "closed") expect(look.name).toBe("Dormant");
      }),
      { numRuns: 400 },
    );
  });
});
