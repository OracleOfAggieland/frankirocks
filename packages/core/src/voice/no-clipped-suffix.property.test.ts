// Feature: voice-control, Property 4: No clipped suffix (R20.1.4; R3.2; spec §3).
// A speculative reply whose audio started while output was muted is never heard afterwards. Any later reply of the
// same turn that is heard was created only after the earlier one was cancelled and the output buffer cleared.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbCall, runCall } from "./testing/arb-call";
import { audible } from "./testing/trace";

describe("Property 4: no clipped suffix", () => {
  it("muted speculative audio is never heard, and a heard replacement follows cancel and clear", () => {
    fc.assert(
      fc.property(arbCall, (steps) => {
        const d = runCall(steps);
        const { steps: trace, responses } = d.trace;
        for (const r of responses.filter((x) => x.purpose === "speculative")) {
          const k = trace.findIndex((s) => s.event.type === "realtime" && s.event.event.type === "output_audio_buffer.started" && s.event.event.response_id === r.id && s.after.outputMuted);
          if (k < 0) continue;
          for (const later of trace.slice(k)) expect(audible(later, r.id)).toBe(false);
          for (const other of responses.filter((x) => x.turnId === r.turnId && x.id !== r.id && x.purpose !== "judge" && x.createStep > k)) {
            if (!trace.slice(other.createStep).some((s) => audible(s, other.id))) continue;
            const window = trace.slice(k, other.createStep + 1);
            const sent = window.flatMap((s) => s.commands.flatMap((c) => (c.kind === "send" ? [c.event] : [])));
            expect(sent.some((e) => e.type === "response.cancel" && e.response_id === r.id)).toBe(true);
            expect(sent.some((e) => e.type === "output_audio_buffer.clear")).toBe(true);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
