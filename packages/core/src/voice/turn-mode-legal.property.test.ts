// Feature: voice-control, the Turn's mode (brief 014, A3). `turnMode` reads what the current Turn is doing from
// the reducer's live fields. Over the wide generator and arbCall, no step leaves the machine in an illegal mode,
// except the modes in ALLOWED, each named by the invariant it breaks. The allow-list only shrinks: a fix that makes
// an allowed mode unreachable fails the last test here until its entry is removed.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbCall, runCall } from "./testing/arb-call";
import { arbWideCall, runWideCall } from "./testing/arb-call-wide";
import { type IllegalTurnMode, isIllegalTurnMode, turnMode } from "./testing/turn-mode";

/** Illegal modes the machine produces today, by the invariant each breaks. */
const ALLOWED: Partial<Record<IllegalTurnMode, string>> = {
  admittedWithoutReply: "admittedTurnId names the Turn whose reply is admitted now (a higher Deck or an error cuts the reply and leaves the id)",
  admittedWithoutTurn: "admittedTurnId names the Turn whose reply is admitted now (the cut Turn is dropped and the id stays)",
  unpostedInRecovery: "a Turn still waiting for its words is never shown the recovery screen, which ends it unposted",
};

function illegalModes(states: Iterable<Parameters<typeof turnMode>[0]>): Set<IllegalTurnMode> {
  const out = new Set<IllegalTurnMode>();
  for (const st of states) {
    const m = turnMode(st);
    if (isIllegalTurnMode(m)) out.add(m);
  }
  return out;
}

const check = (states: Iterable<Parameters<typeof turnMode>[0]>) => {
  for (const m of illegalModes(states)) expect(ALLOWED[m], `illegal Turn mode ${m}`).toBeDefined();
};

describe("the voice Turn is only ever in a legal mode", () => {
  it("over the wide generator, every step's Turn mode is legal or allow-listed", () => {
    fc.assert(
      fc.property(arbWideCall, (steps) => check(runWideCall(steps).trace.steps.map((s) => s.after))),
      { numRuns: 1_000 },
    );
  });

  it("over arbCall, every step's Turn mode is legal or allow-listed", () => {
    fc.assert(
      fc.property(arbCall, (steps) => check(runCall(steps).trace.steps.map((s) => s.after))),
      { numRuns: 1_000 },
    );
  });

  it("every allow-listed mode is still reached (seed 7, 1,000 wide calls), so the allow-list only shrinks", () => {
    const reached = illegalModes(fc.sample(arbWideCall, { seed: 7, numRuns: 1_000 }).flatMap((s) => runWideCall(s).trace.steps.map((x) => x.after)));
    for (const m of Object.keys(ALLOWED) as IllegalTurnMode[]) expect(reached.has(m), `allow-listed ${m} is no longer reached: remove it`).toBe(true);
  });
});
