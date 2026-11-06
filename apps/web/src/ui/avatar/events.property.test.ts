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
