// Feature: what the voice machine sends (brief 040), Property 2: only the owner's hang-up says `user`.
// Since brief 035 a `user` close marks a narrowed Session private (question V-172), so only the owner's own hang-up
// may send it. For any call, every close the machine sends with reason `user` is sent at a `hangupPressed` event and
// names the Session the call held at that moment. The machine's own closes (a Session the swap leaves, a stale
// open's answer, an open answered after the call ended) say `replace`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OPEN_LIMIT_MS, type VoiceCommand } from "./machine";
import { arbWideCall } from "./testing/arb-call-wide";
import { SwapDriver, type SwapStep, arbEarlyOpenCall, arbSwapCall } from "./testing/arb-swap";

const arbCloseCall = fc.record({ kind: fc.constantFrom("wide", "swap", "early"), wide: arbWideCall, swap: arbSwapCall, early: arbEarlyOpenCall });
type CloseCall = { kind: "wide" | "swap" | "early"; wide: readonly unknown[]; swap: readonly SwapStep[]; early: readonly SwapStep[] };

function play(c: CloseCall): SwapDriver {
  const d = new SwapDriver();
  if (c.kind === "early") d.openTimeoutMs = OPEN_LIMIT_MS;
  d.start();
  for (const st of (c.kind === "wide" ? c.wide : c.kind === "swap" ? c.swap : c.early) as SwapStep[]) d.play(st);
  return d;
}

const closes = (cmds: readonly VoiceCommand[]) => cmds.filter((x): x is Extract<VoiceCommand, { kind: "close" }> => x.kind === "close");

describe("Property 2: only the owner's hang-up says user", () => {
  it("every user close follows the owner's hang-up for that Session", () => {
    fc.assert(
      fc.property(arbCloseCall, (c) => {
        const d = play(c);
        for (const s of d.trace.steps) {
          for (const cmd of closes(s.commands)) {
            if (cmd.body.reason !== "user") continue;
            expect(s.event.type, `user close at step ${s.i}`).toBe("hangupPressed");
            expect(cmd.body.sessionId, `user close at step ${s.i}`).toBe(s.before.session?.sessionId);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it("the calls reach the machine's own closes", () => {
    let own = 0;
    for (const c of fc.sample(arbCloseCall, { seed: 2026, numRuns: 300 })) {
      const d = play(c);
      if (d.trace.steps.some((s) => s.event.type !== "hangupPressed" && closes(s.commands).some((x) => x.body.reason !== "error"))) own += 1;
    }
    expect(own).toBeGreaterThanOrEqual(20);
  });
});
