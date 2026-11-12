// Feature: voice-control, mute (brief 014, A3; R15.6, R15.9): only the Owner changes the mic mute.
// Over arbWideCall, `micMuted` changes only on the Owner's `mutePressed`, or when the call ends (CLOSED resets it
// for the next call). A reconnect, a recovery or a new Session never turns a muted mic back on. Red today
// (`it.fails`): the reconnect's open resets `micMuted`. Seed 3 finds it.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbWideCall, runWideCall } from "./testing/arb-call-wide";

describe("only the Owner changes the mic mute", () => {
  it.fails("micMuted changes only on mutePressed or when the call ends", () => {
    fc.assert(
      fc.property(arbWideCall, (steps) => {
        for (const s of runWideCall(steps).trace.steps) {
          if (s.after.micMuted === s.before.micMuted) continue;
          const byOwner = s.event.type === "mutePressed";
          const callEnded = s.after.phase === "CLOSED";
          expect(byOwner || callEnded, `step ${s.i} (${s.event.type}, ${s.before.phase} -> ${s.after.phase}) set micMuted ${s.after.micMuted}`).toBe(true);
        }
      }),
      { numRuns: 1_000, seed: 3 },
    );
  });
});
