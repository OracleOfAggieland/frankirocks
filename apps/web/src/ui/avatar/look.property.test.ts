// Property tests for the Look_Mapper (lab-ui-foundation design "Correctness Properties").
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AvatarState } from "@franki/core";
import { AVATAR_LABELS } from "../copy";
import { EVENT_MS } from "../motion";
import { arbEvent, arbInput, arbLevel } from "../test-arbitraries";
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

// Feature: lab-ui-foundation, Property 3: Ghost_Mode overlay
describe("Property 3: Ghost_Mode overlay", () => {
  it("only sets ghost and body opacity, keeping every other field", () => {
    fc.assert(
      fc.property(arbInput.map((i) => ({ ...i, micMuted: true })), (input) => {
        const ghost = lookFor(input);
        const plain = lookFor({ ...input, micMuted: false });
        expect(ghost.ghost).toBe(true);
        expect(ghost.bodyOpacity).toBe(0.35);
        expect(ghost.eyeOpacity).toBe(1);
        expect({ ...ghost, ghost: false, bodyOpacity: 1 }).toEqual(plain);
        expect(plain.ghost).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: lab-ui-foundation, Property 4: Output muted never drives the body
describe("Property 4: Output muted never drives the body", () => {
  it("never follows output or squishes, and ignores the Output_Level", () => {
    fc.assert(
      fc.property(arbInput.map((i) => ({ ...i, outputMuted: true })), arbLevel, arbLevel, (input, a, b) => {
        const la = lookFor({ ...input, outputLevel: a });
        const lb = lookFor({ ...input, outputLevel: b });
        expect(la.follows).not.toBe("output");
        expect(la.body).not.toBe("squish");
        expect(la).toEqual(lb);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: lab-ui-foundation, Property 5: Invalid levels count as zero
describe("Property 5: Invalid levels count as zero", () => {
  const invalidLevel = fc.oneof(
    fc.constantFrom(NaN, Infinity, -Infinity, 1.0000001, -1e-9, 2, -1),
    fc.double().filter((x) => !(Number.isFinite(x) && x >= 0 && x <= 1)),
  );
  const biased = fc.oneof({ arbitrary: invalidLevel, weight: 3 }, { arbitrary: arbLevel, weight: 1 });
  const valid = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;

  it("treats a non-finite or out-of-range followed level as 0, and keeps drive in 0..1", () => {
    fc.assert(
      fc.property(arbInput, biased, biased, (base, inputLevel, outputLevel) => {
        const input = { ...base, inputLevel, outputLevel };
        const look = lookFor(input);
        expect(look.drive).toBeGreaterThanOrEqual(0);
        expect(look.drive).toBeLessThanOrEqual(1);
        const zeroed = {
          ...input,
          inputLevel: valid(inputLevel) ? inputLevel : 0,
          outputLevel: valid(outputLevel) ? outputLevel : 0,
        };
        expect(look).toEqual(lookFor(zeroed));
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: lab-ui-foundation, Property 6: Every look returns to rest
describe("Property 6: Every look returns to rest", () => {
  it("closed with no event is Dormant; listening, unmuted, with no event is Idle", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        expect(lookFor({ ...input, event: null, state: "closed" }).name).toBe("Dormant");
        const idle = lookFor({ ...input, event: null, state: "listening", firstConnecting: false, micMuted: false });
        expect(idle.name).toBe("Listening");
        expect(idle.ghost).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: lab-ui-foundation, Property 7: Timed events expire in the look
describe("Property 7: Timed events expire in the look", () => {
  const expired = fc
    .constantFrom("wake", "present-card", "celebrate" as const)
    .chain((event) =>
      fc.tuple(fc.constant(event), fc.integer({ min: EVENT_MS[event], max: EVENT_MS[event] + 10000 })),
    );

  it("looks the same as no event once the duration has passed", () => {
    fc.assert(
      fc.property(arbInput, expired, (input, [event, eventElapsedMs]) => {
        expect(lookFor({ ...input, event, eventElapsedMs })).toEqual(lookFor({ ...input, event: null, eventElapsedMs: 0 }));
      }),
      { numRuns: 300 },
    );
  });
});
