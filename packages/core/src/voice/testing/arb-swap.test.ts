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
    // After task 47: the care reply heard on the old call, and the swap line heard on a fresh one.
    careHeard: traces.filter((t) => {
      const cares = new Set(blockedSteps(t).flatMap((x) => (x.event.type === "turnOk" && x.event.response.permit !== null ? [x.event.response.permit.permitId] : [])));
      return t.steps.some((x) => !x.after.outputMuted && x.after.active !== null && cares.has(x.after.active.permit.permitId));
    }).length,
    lineHeard: traces.filter((t) => {
      const lines = new Set(t.steps.flatMap((x) => (x.event.type === "openOk" && x.event.response.proactive !== null ? [x.event.response.proactive.permit.permitId] : [])));
      return t.steps.some((x) => !x.after.outputMuted && x.after.active !== null && lines.has(x.after.active.permit.permitId));
    }).length,
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
    expect(counts.careHeard).toBeGreaterThanOrEqual(20);
    expect(counts.lineHeard).toBeGreaterThanOrEqual(35);
  });
});
