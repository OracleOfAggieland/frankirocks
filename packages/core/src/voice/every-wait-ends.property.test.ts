// Feature: voice-control, Property 6: Every wait ends (R20.1.6; R7.3, KV06).
// From any reachable state, with every armed timer firing at its deadline and no other event, the machine reaches
// LISTENING, RECOVERY or CLOSED within 20 firings and 70 s of opsClock. Keep-alive timers that end no wait (the
// state poll, the 45 s refresh and their retries) are not fired.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbCall, runCall } from "./testing/arb-call";
import { drainTimers } from "./testing/trace";

const KEEP_ALIVE = ["poll", "refresh", "stateRetry", "stateRetryUi"] as const;

describe("Property 6: every wait ends", () => {
  it("timers alone bring every reachable state to LISTENING, RECOVERY or CLOSED", () => {
    fc.assert(
      fc.property(arbCall, (steps) => {
        const d = runCall(steps);
        for (const s of d.trace.steps) {
          const r = drainTimers(s.after, s.now, 20, KEEP_ALIVE);
          expect(r.settled, `stuck after step ${s.i} in ${r.phases.join(" > ")}`).toBe(true);
          expect(r.elapsed).toBeLessThanOrEqual(70_000);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
