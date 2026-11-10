// Feature: voice-control, Property 5: Stale events are inert (R20.1.5; R7.1, R7.2, KV05).
// A Realtime event of another generation, or for a response that is unknown or was cancelled, never changes the
// phase, never unmutes output, and causes no command except `response.cancel` for that response.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbCall, runCall } from "./testing/arb-call";
import type { TraceStep } from "./testing/arb-call";

describe("Property 5: stale events are inert", () => {
  it("other-generation, unknown and cancelled-response events leave phase, mute and commands alone", () => {
    fc.assert(
      fc.property(arbCall, (steps) => {
        const d = runCall(steps);
        const { steps: trace, responses } = d.trace;
        // Only a cancel or teardown after the response was created cancels it: a teardown before that (an earlier
        // reconnect) says nothing about a response of the new call.
        const cancelledBefore = (id: string, createdAt: number, i: number) =>
          trace.slice(createdAt, i).some((s: TraceStep) => s.commands.some((c) => (c.kind === "send" && c.event.type === "response.cancel" && c.event.response_id === id) || c.kind === "teardown"));
        for (const s of trace) {
          if (s.event.type !== "realtime") continue;
          const e = s.event.event;
          const gen = String(s.before.session?.generation ?? -1);
          let staleId: string | null = null;
          if (e.type === "response.created" && e.response.metadata?.generation !== undefined && e.response.metadata.generation !== gen) staleId = e.response.id;
          else if (e.type === "output_audio_buffer.started" || e.type === "response.done") {
            const id = e.type === "response.done" ? e.response.id : e.response_id;
            const known = responses.find((r) => r.id === id && r.createdAt < s.i);
            const judgeDone = e.type === "response.done" && known?.purpose === "judge";
            if (known === undefined) staleId = id;
            else if ((e.type === "output_audio_buffer.started" || judgeDone) && cancelledBefore(id, known.createdAt, s.i)) staleId = id;
          }
          if (staleId === null) continue;
          expect(s.after.phase).toBe(s.before.phase);
          expect(s.before.outputMuted && !s.after.outputMuted).toBe(false);
          for (const c of s.commands) expect(c.kind === "send" && c.event.type === "response.cancel" && c.event.response_id === staleId).toBe(true);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
