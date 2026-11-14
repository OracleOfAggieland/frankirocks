// Feature: forget on the wire (brief 048, rulings 3 and 7): the old call is silent. Over arbForgetCall, a call in
// which a post is answered `blocked` for a forget, the server answers up to BARRIERS_MAX opens `blocked` while its
// barrier is up, and then lets a fresh call through with the acknowledgment:
//   - from the forget answer on, nothing is sent on the call opened before it but the cancel of what it had playing
//     (`response.cancel`, `output_audio_buffer.clear`), and no Turn or tool is posted for its Session;
//   - the first `response.create` after the forget answer says the acknowledgment exactly, and it is sent: the
//     browser's retries outlast every barrier the generated server raises.
// The oracle reads the generated scene (how many barriers, when the fresh call may come) and the commands sent.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GONE_LINE, sayExactly } from "./lines";
import { BARRIERS_MAX, arbForgetCall, runForgetCall } from "./testing/arb-forget";
import { swapCalls } from "./testing/arb-swap";

describe("the old call is silent (brief 048, rulings 3 and 7)", () => {
  it("after a forget answer nothing goes to the old call, and the fresh call first says the acknowledgment", () => {
    fc.assert(
      fc.property(arbForgetCall, (steps) => {
        const d = runForgetCall(steps);
        const t = d.trace;
        const i0 = t.steps.findIndex((s) => s.event.type === "turnOk" && s.event.response.status === "blocked");
        if (i0 < 0) return;
        const ev = t.steps[i0]!.event;
        if (ev.type !== "turnOk") return;
        const old = ev.response.stamp.sessionId;
        const calls = swapCalls(t);
        const oldCall = calls[i0]!;
        for (const s of t.steps.slice(i0)) {
          for (const c of s.commands) {
            if (calls[s.i] === oldCall && c.kind === "send") {
              expect(["response.cancel", "output_audio_buffer.clear"], `step ${s.i}: ${c.event.type} sent on the call opened before the forget`).toContain(c.event.type);
            }
            if ((c.kind === "turn" && c.body.sessionId === old) || (c.kind === "tool" && c.body.stamp.sessionId === old)) throw new Error(`step ${s.i}: a ${c.kind} posted for the forgotten call's Session`);
          }
        }
        expect(d.barrierAt.length).toBeLessThanOrEqual(BARRIERS_MAX);
        const after = t.creates.filter((c) => c.step > i0);
        expect(after.length, `nothing said after the forget answer; phases ${t.steps.slice(i0).map((s) => s.after.phase).join(" ")}`).toBeGreaterThan(0);
        const first = after[0]!.event;
        expect(first.type === "response.create" ? (first.response as { instructions?: string } | undefined)?.instructions : null).toBe(sayExactly(GONE_LINE));
      }),
      { numRuns: 300 },
    );
  });
});
