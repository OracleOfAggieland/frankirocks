// Brief 031, finding 1: a swap never adopts an open sent before the `blocked` answer arrived. Over arbEarlyOpenCall,
// label each call by the step that sent its open (`openedAt`). For every `turnOk` answered `blocked` at step i, at
// every later step a response heard was created on a call whose open was sent at step i or after, or it is the care reply
// of that blocked Turn. Property 10 labels calls by their `connect` and its driver answers every open as if the
// narrowing had committed first, so it cannot see an open handled before the narrowing; this driver can
// (`openEarly`). An open is answered only inside the Voice_Client's own open timeout, as it is in the browser.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbEarlyOpenCall, openedAt, runEarlyOpenCall } from "./testing/arb-swap";
import { audibleResponse } from "./testing/trace";

describe("a swap's fresh call is opened after the blocked answer", () => {
  it("after a blocked answer, nothing is heard from a call whose open was sent before it but that Turn's care reply", () => {
    fc.assert(
      fc.property(arbEarlyOpenCall, (steps) => {
        const d = runEarlyOpenCall(steps);
        const trace = d.trace;
        const opened = openedAt(d);
        const createdOn = new Map(trace.responses.map((r) => [r.id, opened[r.createdAt] ?? -1]));
        trace.steps.forEach((b, i) => {
          if (b.event.type !== "turnOk" || b.event.response.status !== "blocked") return;
          const care = b.event.response.permit?.permitId ?? null;
          for (const later of trace.steps.slice(i + 1)) {
            const r = audibleResponse(later);
            if (r === null) continue;
            const fresh = (createdOn.get(r) ?? -1) >= i;
            const careReply = care !== null && later.after.active?.responseId === r && later.after.active.permit.permitId === care;
            expect(fresh || careReply, `response ${r} heard at step ${later.i} after the blocked answer at step ${i}`).toBe(true);
          }
        });
      }),
      { numRuns: 1_000 },
    );
  });
});
