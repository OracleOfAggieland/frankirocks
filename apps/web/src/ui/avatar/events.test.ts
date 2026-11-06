import { describe, expect, it } from "vitest";
import { type EventInput, type EventState, currentEvent, initialEventState, reduceEvents } from "./events";

const run = (inputs: EventInput[], from: EventState = initialEventState) => inputs.reduce(reduceEvents, from);

describe("Event_Controller examples", () => {
  it("starts wake automatically on the first connecting state", () => {
    const s = run([{ kind: "state", state: "connecting", at: 100 }, { kind: "frame", at: 700 }]);
    expect(currentEvent(s)).toEqual({ event: "wake", eventElapsedMs: 600, firstConnecting: true });
    const done = reduceEvents(s, { kind: "frame", at: 1300 });
    expect(currentEvent(done)).toEqual({ event: null, eventElapsedMs: 0, firstConnecting: false });
  });

  it("ignores an explicit wake and a second connecting after the Visit's wake", () => {
    const s = run([
      { kind: "state", state: "connecting", at: 0 },
      { kind: "frame", at: 1500 },
      { kind: "state", state: "closed", at: 1600 },
      { kind: "state", state: "connecting", at: 1700 },
      { kind: "event", event: "wake", at: 1800 },
    ]);
    expect(currentEvent(s).event).toBeNull();
    expect(s.woke).toBe(true);
  });

  it("drops present-card during wake, and accepts it after", () => {
    const during = run([{ kind: "state", state: "connecting", at: 0 }, { kind: "event", event: "present-card", at: 500 }]);
    expect(currentEvent(during).event).toBe("wake");
    const after = run([{ kind: "frame", at: 1300 }, { kind: "event", event: "present-card", at: 1300 }], during);
    expect(currentEvent(after)).toMatchObject({ event: "present-card", eventElapsedMs: 0 });
  });

  it("never moves Frame_Time backward", () => {
    const s = run([
      { kind: "event", event: "celebrate", at: 1000 },
      { kind: "frame", at: 1500 },
      { kind: "frame", at: 200 },
    ]);
    expect(s.now).toBe(1500);
    expect(currentEvent(s)).toMatchObject({ event: "celebrate", eventElapsedMs: 500 });
  });

  it("clears the approval wait on approvalDone, closed and signOut", () => {
    const waiting = run([{ kind: "await", approvalId: "a1", at: 0 }]);
    expect(currentEvent(waiting).event).toBe("await-approval");
    expect(currentEvent(reduceEvents(waiting, { kind: "approvalDone", approvalId: "other", at: 1 })).event).toBe("await-approval");
    expect(currentEvent(reduceEvents(waiting, { kind: "approvalDone", approvalId: "a1", at: 1 })).event).toBeNull();
    expect(currentEvent(reduceEvents(waiting, { kind: "state", state: "closed", at: 1 })).event).toBeNull();
  });

  it("signOut clears both slots", () => {
    const s = run([
      { kind: "await", approvalId: "a1", at: 0 },
      { kind: "event", event: "celebrate", at: 10 },
      { kind: "signOut", at: 20 },
    ]);
    expect(s.timed).toBeNull();
    expect(s.awaiting).toBeNull();
    expect(currentEvent(s).event).toBeNull();
  });
});
