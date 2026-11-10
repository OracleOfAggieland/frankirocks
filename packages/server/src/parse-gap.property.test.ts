// Feature: voice-control, Property 11: A repaired gap leaves no trace (R20.1.11; R7.8, R11.9, R15.3, R15.4, R15.7).
// A turn whose first parse fails by deadline or transport and is then repaired with an ordinary result (11), or
// whose transcript is posted missing and then superseded with an ordinary final transcript (11b), leaves the same
// Session, Turns, later outcomes and StateAck as a run in which nothing went wrong. The wrong turn's own reply is
// not compared: by design it heard the neutral line, or nothing.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbPlan, runPlan } from "./testing/arb-turns";

describe("Property 11: a repaired gap leaves no trace", () => {
  it("after a repair or a superseding post, the Session state equals the in-time run's", async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const [wrong, right] = await Promise.all([runPlan(plan, true), runPlan(plan, false)]);
        expect(wrong).toEqual(right);
      }),
      { numRuns: 200 },
    );
  }, 120_000);
});
