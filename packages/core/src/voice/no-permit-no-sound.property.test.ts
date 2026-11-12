// Feature: voice-control, Property 1: No permit, no sound (R20.1.1; R3.1, R6.1, KV02, KV03).
// Output is unmuted only in SPEAKING, under an active reply whose Permit is bound to the current Stamp and
// generation; and at the step that unmutes, that Permit is unexpired and its hash equals the payload's hash.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { payloadHash } from "../admission";
import { msFromTs } from "../schema/primitives";
import { localStamp, replyPayload, sameStamp } from "./machine";
import { arbCall, runCall, testHasher } from "./testing/arb-call";

describe("Property 1: no permit, no sound", () => {
  it("unmuted only in SPEAKING under a checked Permit for the current turn and generation", () => {
    fc.assert(
      fc.property(arbCall, (steps) => {
        const d = runCall(steps);
        for (const s of d.trace.steps) {
          const st = s.after;
          if (st.outputMuted) continue;
          expect(st.phase).toBe("SPEAKING");
          const a = st.active;
          expect(a).not.toBeNull();
          const stamp = localStamp(st);
          expect(stamp).not.toBeNull();
          expect(sameStamp(a!.permit.stamp, stamp!)).toBe(true);
          expect(a!.permit.stamp.generation).toBe(st.session!.generation);
          if (s.before.outputMuted) {
            expect(msFromTs(a!.permit.expiresAt)).toBeGreaterThan(s.now);
            const payload = replyPayload(st, a!);
            expect(payload).not.toBeNull();
            expect(payloadHash(payload!, testHasher)).toBe(a!.permit.approvedPayloadHash);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
