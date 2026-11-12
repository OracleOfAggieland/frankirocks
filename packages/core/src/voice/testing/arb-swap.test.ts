import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbSwapCall, runSwapCall } from "./arb-swap";

/**
 * How many of 500 calls (seed 2026) reach each situation, printed so a run shows the margin over its floor. The
 * floors are about half the counts measured when the generator was written (278, 155, 62, 136).
 */
function reach() {
  const traces = fc.sample(arbSwapCall, { seed: 2026, numRuns: 500 }).map((x) => runSwapCall(x).trace);
  const blockedSteps = (t: (typeof traces)[number]) => t.steps.filter((x) => x.event.type === "turnOk" && x.event.response.status === "blocked");
  return {
    blocked: traces.filter((t) => blockedSteps(t).length > 0).length,
    care: traces.filter((t) => blockedSteps(t).some((x) => x.event.type === "turnOk" && x.event.response.permit !== null)).length,
    whilePlaying: traces.filter((t) => blockedSteps(t).some((x) => !x.before.outputMuted)).length,
    inRecovery: traces.filter((t) => blockedSteps(t).some((x) => x.before.recovery?.kind === "connection")).length,
  };
}

describe("swap call generator", () => {
  it("answers posts blocked, with and without the care Permit, while a reply plays and during connection recovery", () => {
    const counts = reach();
    console.log(`swap generator reach over 500 calls (seed 2026): ${JSON.stringify(counts)}`);
    expect(counts.blocked).toBeGreaterThanOrEqual(140);
    expect(counts.care).toBeGreaterThanOrEqual(75);
    expect(counts.whilePlaying).toBeGreaterThanOrEqual(30);
    expect(counts.inRecovery).toBeGreaterThanOrEqual(65);
  });
});
