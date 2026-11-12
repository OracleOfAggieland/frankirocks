// Feature: what the voice machine sends (brief 040), Property 3: every open of a visit names it.
// The visit ID reaches the machine as input (`visitSet`, from the controller that reads the screen's visit model).
// For any call, with the visit set before the call or changed at any step, every open the machine sends after the
// visit is set carries the latest visit ID, and none carries an older one: the first open, a retry, a reconnect, the
// swap's open and the one sent after a stale open's answer.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OPEN_LIMIT_MS, type VoiceCommand } from "./machine";
import { arbWideCall } from "./testing/arb-call-wide";
import { SwapDriver, type SwapStep, arbEarlyOpenCall, arbSwapCall } from "./testing/arb-swap";

const visitIdOf = (n: number) => `v${String(n).padStart(42, "0")}`;

const arbVisitCall = fc.record({
  kind: fc.constantFrom("wide", "swap", "early"),
  wide: arbWideCall,
  swap: arbSwapCall,
  early: arbEarlyOpenCall,
  before: fc.boolean(),
  changes: fc.array(fc.nat({ max: 110 }), { maxLength: 3 }),
});

type VisitCall = { kind: "wide" | "swap" | "early"; wide: readonly unknown[]; swap: readonly SwapStep[]; early: readonly SwapStep[]; before: boolean; changes: readonly number[] };

function play(c: VisitCall) {
  const steps = (c.kind === "wide" ? c.wide : c.kind === "swap" ? c.swap : c.early) as SwapStep[];
  const d = new SwapDriver();
  if (c.kind === "early") d.openTimeoutMs = OPEN_LIMIT_MS;
  let n = 0;
  const set = () => d.ev({ type: "visitSet", visitId: visitIdOf(++n) });
  if (c.before) set();
  d.start();
  steps.forEach((st, i) => {
    if (c.changes.includes(i)) set();
    d.play(st);
  });
  return d;
}

describe("Property 3: every open of a visit names it", () => {
  it("after the visit is set, every open carries the latest visit ID", () => {
    fc.assert(
      fc.property(arbVisitCall, (c) => {
        const d = play(c);
        let current: string | null = null;
        for (const s of d.trace.steps) {
          const ev = s.event as { type: string; visitId?: string | null };
          if (ev.type === "visitSet") current = ev.visitId ?? null;
          for (const cmd of s.commands.filter((x): x is Extract<VoiceCommand, { kind: "open" }> => x.kind === "open")) {
            if (current !== null) expect(cmd.body.visitId, `open at step ${s.i}`).toBe(current);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it("the calls reach opens after the visit is set, beyond the first", () => {
    let later = 0;
    for (const c of fc.sample(arbVisitCall, { seed: 2026, numRuns: 300 })) {
      const d = play({ ...c, before: true });
      if (d.trace.steps.flatMap((s) => s.commands).filter((x) => x.kind === "open").length > 1) later += 1;
    }
    expect(later).toBeGreaterThanOrEqual(60);
  });
});
