// Feature: voice-control, the Turn's mode (brief 014, A3). `turnMode` reads what the current Turn is doing from
// the reducer's live fields. Over the wide generator and arbCall, no step leaves the machine in an illegal mode,
// except the modes in TURN_MODES_ALLOWED (testing/turn-mode.ts), each named by the invariant it breaks.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbCall, runCall } from "./testing/arb-call";
import { arbWideCall, runWideCall } from "./testing/arb-call-wide";
import { type IllegalTurnMode, TURN_MODES_ALLOWED, isIllegalTurnMode, turnMode } from "./testing/turn-mode";

function illegalModes(states: Iterable<Parameters<typeof turnMode>[0]>): Set<IllegalTurnMode> {
  const out = new Set<IllegalTurnMode>();
  for (const st of states) {
    const m = turnMode(st);
    if (isIllegalTurnMode(m)) out.add(m);
  }
  return out;
}

const check = (states: Iterable<Parameters<typeof turnMode>[0]>) => {
  for (const m of illegalModes(states)) expect(TURN_MODES_ALLOWED[m], `illegal Turn mode ${m}`).toBeDefined();
};

describe("the voice Turn is only ever in a legal mode", () => {
  it("over the wide generator, every step's Turn mode is legal or allow-listed", () => {
    fc.assert(
      fc.property(arbWideCall, (steps) => check(runWideCall(steps).trace.steps.map((s) => s.after))),
      { numRuns: 1_000, seed: 20261111 },
    );
  });

  it("over arbCall, every step's Turn mode is legal or allow-listed", () => {
    fc.assert(
      fc.property(arbCall, (steps) => check(runCall(steps).trace.steps.map((s) => s.after))),
      { numRuns: 1_000, seed: 20261112 },
    );
  });
});
