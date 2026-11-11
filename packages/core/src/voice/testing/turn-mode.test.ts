import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbWideCall, runWideCall } from "./arb-call-wide";
import { type IllegalTurnMode, TURN_MODES_ALLOWED, isIllegalTurnMode, turnMode } from "./turn-mode";

describe("the Turn-mode allow-list", () => {
  it("every allow-listed mode is still reached (seed 7, 1,000 wide calls), so the allow-list only shrinks", () => {
    const reached = new Set<IllegalTurnMode>();
    for (const s of fc.sample(arbWideCall, { seed: 7, numRuns: 1_000 })) {
      for (const x of runWideCall(s).trace.steps) {
        const m = turnMode(x.after);
        if (isIllegalTurnMode(m)) reached.add(m);
      }
    }
    for (const m of Object.keys(TURN_MODES_ALLOWED) as IllegalTurnMode[]) expect(reached.has(m), `allow-listed ${m} is no longer reached: remove it`).toBe(true);
  });
});
