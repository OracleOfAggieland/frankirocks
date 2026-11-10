// Feature: voice-control, Property 2: A held reply never resumes (R20.1.2; R3.3–R3.5).
// Once the machine's current judge for a turn answers anything but a valid O, or its judge deadline fires with no
// verdict, no audio of that turn's speculative reply is ever audible again, whatever arrives later.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseJudgeDone } from "./judge";
import { arbCall, runCall } from "./testing/arb-call";
import { audible } from "./testing/trace";

describe("Property 2: a held reply never resumes", () => {
  it("after H, U, an invalid verdict or the judge deadline, the turn's speculative reply is never heard", () => {
    fc.assert(
      fc.property(arbCall, (steps) => {
        const d = runCall(steps);
        const { steps: trace, responses } = d.trace;
        for (const s of trace) {
          const j = s.before.judge;
          if (j === null) continue;
          let held = false;
          if (s.event.type === "realtime" && s.event.event.type === "response.done" && j.responseId !== null && s.event.event.response.id === j.responseId) {
            const v = parseJudgeDone(s.event.event);
            held = !(v.valid && v.verdict === "O");
          }
          if (s.event.type === "timer" && s.event.name === "judge" && j.verdict === null && s.before.deadlines.judge !== undefined && s.now >= s.before.deadlines.judge) held = true;
          if (!held) continue;
          const specs = responses.filter((r) => r.purpose === "speculative" && r.turnId === j.turnId).map((r) => r.id);
          for (const later of trace.slice(s.i)) for (const id of specs) expect(audible(later, id)).toBe(false);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
