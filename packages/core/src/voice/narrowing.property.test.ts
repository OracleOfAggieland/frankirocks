// Feature: voice-control, Property 10: Narrowing needs a closed call (R20.1.10; R14.1, R14.5, R14.7; design
// "Correctness Properties" 10). Over arbSwapCall, label each `connect` command a new call. For every `turnOk`
// answered `blocked` at step i, at every later step j a response heard was created on a call opened after step i,
// or it is the care reply of that blocked Turn: the reply under the answer's own care Permit. Red first
// (`it.fails`) until task 47 builds SWAPPING: today a `blocked` answer leaves a playing fastO reply playing.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbSwapCall, runSwapCall, swapCalls } from "./testing/arb-swap";
import { audibleResponse } from "./testing/trace";

describe("Property 10: narrowing needs a closed call", () => {
  it("after a blocked answer, nothing is heard from a call opened before it but that Turn's care reply", () => {
    fc.assert(
      fc.property(arbSwapCall, (steps) => {
        const trace = runSwapCall(steps).trace;
        const calls = swapCalls(trace);
        const createdOn = new Map(trace.responses.map((r) => [r.id, calls[r.createdAt] ?? 0]));
        trace.steps.forEach((b, i) => {
          if (b.event.type !== "turnOk" || b.event.response.status !== "blocked") return;
          const care = b.event.response.permit?.permitId ?? null;
          for (const later of trace.steps.slice(i + 1)) {
            const r = audibleResponse(later);
            if (r === null) continue;
            const fresh = (createdOn.get(r) ?? 0) > calls[i]!;
            const careReply = care !== null && later.after.active?.responseId === r && later.after.active.permit.permitId === care;
            expect(fresh || careReply, `response ${r} heard at step ${later.i} after the blocked answer at step ${i}`).toBe(true);
          }
        });
      }),
      { numRuns: 1_000 },
    );
  });
});
