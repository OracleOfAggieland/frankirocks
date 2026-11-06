// Property tests for the Event_Controller (lab-ui-foundation design "Correctness Properties").
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbEventInputs } from "../test-arbitraries";
import { type EventInput, type EventState, currentEvent, initialEventState, reduceEvents } from "./events";

/** Runs the inputs and records every step where the timed slot took a new event. */
function trace(inputs: readonly EventInput[]) {
  let s: EventState = initialEventState;
  const starts: { at: number; event: string }[] = [];
  for (const input of inputs) {
    const next = reduceEvents(s, input);
    if (next.timed !== null && next.timed !== s.timed && (s.timed === null || next.timed.startedAt !== s.timed.startedAt || next.timed.event !== s.timed.event)) {
      starts.push({ at: next.timed.startedAt, event: next.timed.event });
    }
    s = next;
  }
  return { state: s, starts };
}

// Feature: lab-ui-foundation, Property 8: No dead ends in the Event_Controller
describe("Property 8: No dead ends in the Event_Controller", () => {
  it("reports no timed event once 1600 ms of Frame_Time pass after the last new event", () => {
    fc.assert(
      fc.property(arbEventInputs, fc.nat(5000), (inputs, extra) => {
        const { state, starts } = trace(inputs);
        const last = starts.length > 0 ? starts[starts.length - 1].at : (state.now ?? 0);
        const end = reduceEvents(state, { kind: "frame", at: last + 1600 + extra });
        const current = currentEvent(end);
        expect(["wake", "present-card", "celebrate"]).not.toContain(current.event);
        expect(current.firstConnecting).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: lab-ui-foundation, Property 9: Approval waits end when the approval ends
describe("Property 9: Approval waits end when the approval ends", () => {
  const ending = fc.constantFrom<"done" | "closed" | "signOut">("done", "closed", "signOut");

  it("does not report await-approval after its approvalDone, closed or signOut", () => {
    fc.assert(
      fc.property(arbEventInputs, arbEventInputs, fc.constantFrom("a1", "a2", "a3"), ending, (prefix, middle0, id, end) => {
        const middle = middle0.filter((i) => i.kind !== "await");
        const t0 = prefix[prefix.length - 1].at;
        const shifted = middle.map((i) => ({ ...i, at: i.at + t0 + 1 }));
        const tEnd = (shifted[shifted.length - 1]?.at ?? t0 + 1) + 1;
        const endInput: EventInput =
          end === "done"
            ? { kind: "approvalDone", approvalId: id, at: tEnd }
            : end === "closed"
              ? { kind: "state", state: "closed", at: tEnd }
              : { kind: "signOut", at: tEnd };
        const inputs: EventInput[] = [...prefix, { kind: "await", approvalId: id, at: t0 }, ...shifted, endInput];
        const s = inputs.reduce(reduceEvents, initialEventState);
        expect(currentEvent(s).event).not.toBe("await-approval");
        expect(s.awaiting).toBeNull();
      }),
      { numRuns: 300 },
    );
  });
});
