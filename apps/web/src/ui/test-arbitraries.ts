// Shared fast-check generators for the lab-ui-foundation property tests (design "Correctness
// Properties"). Imported by tests only.
import type { AvatarState } from "@franki/core";
import fc from "fast-check";
import type { AvatarEvent, AvatarInput, TimedEvent } from "./avatar/types";

export const AVATAR_STATES: readonly AvatarState[] = ["closed", "connecting", "listening", "thinking", "speaking", "recovery"];

export const arbState: fc.Arbitrary<AvatarState> = fc.constantFrom(...AVATAR_STATES);

export const arbEvent: fc.Arbitrary<AvatarEvent | null> = fc.constantFrom(null, "wake", "present-card", "await-approval", "celebrate");

export const arbLevel: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double(),
  fc.constantFrom(NaN, Infinity, -Infinity, -0, 1.0000001, -1e-9),
);

export const arbElapsed: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 0, max: 5000 }),
  fc.double(),
  fc.constantFrom(1199, 1200, 799, 800, 1599, 1600),
);

export const arbInput: fc.Arbitrary<AvatarInput> = fc.record({
  state: arbState,
  micMuted: fc.boolean(),
  outputMuted: fc.boolean(),
  inputLevel: arbLevel,
  outputLevel: arbLevel,
  event: arbEvent,
  eventElapsedMs: arbElapsed,
  firstConnecting: fc.boolean(),
  reducedMotion: fc.boolean(),
});

/** The Event_Controller input shape (design "Event_Controller"), without the `at` field. */
export type EventInputBody =
  | { kind: "frame" }
  | { kind: "state"; state: AvatarState }
  | { kind: "event"; event: TimedEvent }
  | { kind: "await"; approvalId: string }
  | { kind: "approvalDone"; approvalId: string }
  | { kind: "signOut" };

export type EventInputShape = EventInputBody & { at: number };

const approvalId = fc.constantFrom("a1", "a2", "a3");

export const arbEventBody: fc.Arbitrary<EventInputBody> = fc.oneof(
  fc.constant({ kind: "frame" as const }),
  arbState.map((state) => ({ kind: "state" as const, state })),
  fc.constantFrom<TimedEvent>("wake", "present-card", "celebrate").map((event) => ({ kind: "event" as const, event })),
  approvalId.map((id) => ({ kind: "await" as const, approvalId: id })),
  approvalId.map((id) => ({ kind: "approvalDone" as const, approvalId: id })),
  fc.constant({ kind: "signOut" as const }),
);

/** Attaches non-decreasing Frame_Times (gaps of 0 to 400 ms) to a list of input bodies. */
export function withTimes(bodies: readonly EventInputBody[], gaps: readonly number[], start = 0): EventInputShape[] {
  let at = start;
  return bodies.map((body, i) => {
    at += gaps[i % Math.max(1, gaps.length)] ?? 0;
    return { ...body, at };
  });
}

export const arbEventInputs: fc.Arbitrary<EventInputShape[]> = fc
  .array(fc.tuple(arbEventBody, fc.integer({ min: 0, max: 400 })), { minLength: 1, maxLength: 50 })
  .map((pairs) =>
    withTimes(
      pairs.map(([b]) => b),
      pairs.map(([, g]) => g),
    ),
  );
