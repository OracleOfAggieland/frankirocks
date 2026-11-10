// Feature: voice-control, Property 3: Nothing dispatches before admission (R20.1.3; R6.2, R6.3, KV02).
// For every turn, no `/api/tool` request and no `admitted` or `playbackStarted` receipt is emitted before the step
// at which a reply of that turn became the machine's admitted (active) reply.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbCall, runCall } from "./testing/arb-call";
import { admittedAt } from "./testing/trace";

describe("Property 3: nothing dispatches before admission", () => {
  it("tool requests and admitted or playbackStarted receipts come at or after the turn's admission", () => {
    fc.assert(
      fc.property(arbCall, (steps) => {
        const d = runCall(steps);
        for (const s of d.trace.steps) {
          for (const c of s.commands) {
            const dispatch = c.kind === "tool" || (c.kind === "receipt" && (c.body.kind === "admitted" || c.body.kind === "playbackStarted"));
            if (!dispatch) continue;
            const turnId = c.body.stamp.turnId;
            const at = admittedAt(d.trace, turnId);
            expect(at, `${c.kind} for ${turnId} at step ${s.i} with no admission`).not.toBeNull();
            expect(s.i).toBeGreaterThanOrEqual(at!);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
