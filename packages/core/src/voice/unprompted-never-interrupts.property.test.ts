// Feature: the review of what reaches the wire (brief 045, part V), property 4: an unprompted line never
// interrupts. A state answer's line plays only when it arrives in LISTENING, with no Turn, reply, judge or
// speculation under way and no speech open or started since the state request went out (the quiet the state route
// required, and nothing since). A line issued for another Session, another call (generation) or another audience is
// never played.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbProactiveCall, runProactiveCall } from "./testing/arb-proactive";

describe("Property 4 (brief 045): an unprompted line never interrupts", () => {
  it("a played line arrived in a quiet LISTENING; a line for another Session, call or audience never plays", () => {
    fc.assert(
      fc.property(arbProactiveCall, (c) => {
        const d = runProactiveCall(c);
        for (const x of d.delivered) {
          if (x.variant === "open") continue;
          const creates = d.createsFor(x.p);
          if (x.variant !== "ok") {
            expect(creates, `a line for ${x.variant} played`).toEqual([]);
            continue;
          }
          if (creates.length === 0) continue;
          const at = d.trace.steps[x.step]!;
          const b = at.before;
          expect(b.phase, `line ${x.p.turnId} played from ${b.phase}`).toBe("LISTENING");
          expect(b.turn === null && b.pending === null && b.active === null && b.inFlight.length === 0 && b.judge === null && b.spec === null, `line ${x.p.turnId} played over a Turn or reply`).toBe(true);
          expect(b.speech.some((s) => s.startMs !== null && s.endMs === null), `line ${x.p.turnId} played over open speech`).toBe(false);
          const spoke = d.trace.steps.slice(0, x.step).some((s) => s.now >= x.sentAt && s.event.type === "realtime" && s.event.event.type === "input_audio_buffer.speech_started");
          expect(spoke, `line ${x.p.turnId} played after speech since its request`).toBe(false);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
