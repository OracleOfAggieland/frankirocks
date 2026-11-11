// Feature: voice-control, the Turn's mode (brief 014, A3). `turnMode` reads what the current Turn is doing from
// the reducer's live fields. Over the wide generator and arbCall, no step leaves the machine in an illegal mode,
// except the modes in TURN_MODES_ALLOWED (testing/turn-mode.ts), each named by the invariant it breaks.
// Each generator runs two passes of 1,000 calls: a fixed-seed pass, which replays the same calls every run so the
// known shapes are caught every time, and an unseeded pass, which draws new calls every run to explore rare paths.
// fast-check prints the seed and path of any failure, so an unseeded failure reproduces from its message.
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
  it.each([
    ["fixed seed 20261111", 20261111],
    ["fresh seed", undefined],
  ] as const)("over the wide generator (%s), every step's Turn mode is legal or allow-listed", (_pass, seed) => {
    fc.assert(
      fc.property(arbWideCall, (steps) => check(runWideCall(steps).trace.steps.map((s) => s.after))),
      { numRuns: 1_000, seed },
    );
  });

  it.each([
    ["fixed seed 20261112", 20261112],
    ["fresh seed", undefined],
  ] as const)("over arbCall (%s), every step's Turn mode is legal or allow-listed", (_pass, seed) => {
    fc.assert(
      fc.property(arbCall, (steps) => check(runCall(steps).trace.steps.map((s) => s.after))),
      { numRuns: 1_000, seed },
    );
  });
});
