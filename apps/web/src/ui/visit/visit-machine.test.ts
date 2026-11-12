import { describe, expect, it } from "vitest";
import { PROACTIVE_ANSWER } from "../../app/specimens/_fixtures/visit";
import { BARRIER_WAIT_MS, INITIAL_VISIT, type VisitEvent, type VisitState, boltEnabled, visitBadge, visitStep } from "./visit-machine";

const FRI = Date.UTC(2026, 10, 6, 8, 40);
const THU = Date.UTC(2026, 10, 12, 18, 0);

function run(events: VisitEvent[], from: VisitState = INITIAL_VISIT) {
  let s = from;
  const commands = [];
  for (const e of events) {
    const out = visitStep(s, e);
    s = out.state;
    commands.push(...out.commands);
  }
  return { s, commands };
}

const ready = () => run([{ kind: "entered", stored: null, newVisitId: "v1" }, { kind: "resetAnswered", seq: 1, fixtureNamespace: "ns1", worldMs: FRI }]).s;

describe("ui.visit", () => {
  it("first entry: stores the new ID, then calls reset once", () => {
    const { s, commands } = run([{ kind: "entered", stored: null, newVisitId: "v1" }]);
    expect(s.phase).toBe("cloning");
    expect(commands).toEqual([
      { kind: "store", visit: { visitId: "v1", fixtureNamespace: null, worldClockMs: null } },
      { kind: "reset", seq: 1, visitId: "v1" },
    ]);
  });

  it("the reset's answer makes it ready, stores the month and refreshes the screen", () => {
    const { s, commands } = run([{ kind: "entered", stored: null, newVisitId: "v1" }, { kind: "resetAnswered", seq: 1, fixtureNamespace: "ns1", worldMs: FRI }]);
    expect(s.phase).toBe("ready");
    expect(s.worldMs).toBe(FRI);
    expect(commands.slice(2)).toEqual([{ kind: "store", visit: { visitId: "v1", fixtureNamespace: "ns1", worldClockMs: FRI } }, { kind: "afterReset" }]);
  });

  it("a reload with a stored month is ready at once, with no reset", () => {
    const { s, commands } = run([{ kind: "entered", stored: { visitId: "v1", fixtureNamespace: "ns1", worldClockMs: FRI }, newVisitId: "v2" }]);
    expect(s.phase).toBe("ready");
    expect(s.visit?.visitId).toBe("v1");
    expect(commands).toEqual([]);
  });

  it("a reload during a clone shows try again and sends nothing until pressed", () => {
    const { s, commands } = run([{ kind: "entered", stored: { visitId: "v1", fixtureNamespace: null, worldClockMs: null }, newVisitId: "v2" }]);
    expect(s.phase).toBe("failed");
    expect(s.failure).toBe("interrupted");
    expect(commands).toEqual([]);
    const retried = run([{ kind: "retry" }], s);
    expect(retried.s.phase).toBe("cloning");
    expect(retried.commands.at(-1)).toEqual({ kind: "reset", seq: 1, visitId: "v1" });
  });

  it("a failed clone is failed, never ready, and a barrier says so", () => {
    const failed = run([{ kind: "entered", stored: null, newVisitId: "v1" }, { kind: "resetFailed", seq: 1, why: "timeout" }]).s;
    expect(failed).toMatchObject({ phase: "failed", failure: "clone" });
    const barred = run([{ kind: "entered", stored: null, newVisitId: "v1" }, { kind: "resetFailed", seq: 1, why: "barrier" }]).s;
    expect(barred).toMatchObject({ phase: "failed", failure: "barrier" });
    expect(boltEnabled(failed)).toBe(false);
  });

  it("the bolt advances forward only and shows the proactive line", () => {
    const s0 = ready();
    expect(visitStep(s0, { kind: "boltPressed", toMs: FRI }).commands).toEqual([]);
    expect(visitStep(s0, { kind: "boltPressed", toMs: FRI - 1 }).commands).toEqual([]);
    const pressed = visitStep(s0, { kind: "boltPressed", toMs: THU });
    expect(pressed.commands).toEqual([{ kind: "advance", seq: 2, fixtureNamespace: "ns1", toMs: THU }]);
    expect(boltEnabled(pressed.state)).toBe(false);
    const answered = visitStep(pressed.state, { kind: "advanceAnswered", seq: 2, worldMs: THU, proactive: PROACTIVE_ANSWER });
    expect(answered.state.worldMs).toBe(THU);
    expect(answered.commands).toEqual([{ kind: "store", visit: { visitId: "v1", fixtureNamespace: "ns1", worldClockMs: THU } }, { kind: "show", proactive: PROACTIVE_ANSWER }]);
  });

  it("a second press while one is moving sends nothing", () => {
    const pressed = visitStep(ready(), { kind: "boltPressed", toMs: THU }).state;
    expect(visitStep(pressed, { kind: "boltPressed", toMs: THU + 1 }).commands).toEqual([]);
  });

  it("a barrier holds the bolt, waiting, until the wait is over", () => {
    const pressed = visitStep(ready(), { kind: "boltPressed", toMs: THU }).state;
    const held = visitStep(pressed, { kind: "advanceFailed", seq: 2, why: "barrier", retryAfterMs: 0 });
    expect(held.state.bolt).toBe("waiting");
    expect(held.commands).toEqual([{ kind: "wait", ms: BARRIER_WAIT_MS }]);
    expect(boltEnabled(held.state)).toBe(false);
    expect(visitStep(held.state, { kind: "waitOver" }).state.bolt).toBe("idle");
    expect(visitStep(pressed, { kind: "advanceFailed", seq: 2, why: "barrier", retryAfterMs: 1200 }).commands).toEqual([{ kind: "wait", ms: 1200 }]);
  });

  it("a stale answer changes nothing", () => {
    const pressed = visitStep(ready(), { kind: "boltPressed", toMs: THU }).state;
    expect(visitStep(pressed, { kind: "advanceAnswered", seq: 1, worldMs: THU, proactive: null }).state).toBe(pressed);
  });

  it("a timeout leaves the clock where it was and says the bolt did not move", () => {
    const pressed = visitStep(ready(), { kind: "boltPressed", toMs: THU }).state;
    const out = visitStep(pressed, { kind: "advanceFailed", seq: 2, why: "timeout", retryAfterMs: 0 }).state;
    expect(out).toMatchObject({ bolt: "idle", boltFailed: true, worldMs: FRI });
  });

  it("start over needs one confirmation, and cancel sends nothing", () => {
    const asked = visitStep(ready(), { kind: "startOverAsked" }).state;
    expect(asked.confirming).toBe(true);
    expect(visitStep(asked, { kind: "startOverCancelled" })).toEqual({ state: { ...asked, confirming: false }, commands: [] });
    const go = visitStep(asked, { kind: "startOverConfirmed", inCall: false });
    expect(go.state.phase).toBe("resetting");
    expect(go.commands).toEqual([{ kind: "store", visit: { visitId: "v1", fixtureNamespace: null, worldClockMs: null } }, { kind: "reset", seq: 2, visitId: "v1" }]);
  });

  it("a start over during a call ends the call first", () => {
    const asked = visitStep(ready(), { kind: "startOverAsked" }).state;
    const go = visitStep(asked, { kind: "startOverConfirmed", inCall: true });
    expect(go.state).toMatchObject({ phase: "resetting", endingCall: true });
    expect(go.commands.map((c) => c.kind)).toEqual(["store", "endCall"]);
    const ended = visitStep(go.state, { kind: "callEnded" });
    expect(ended.commands).toEqual([{ kind: "reset", seq: 2, visitId: "v1" }]);
    const back = visitStep(ended.state, { kind: "resetAnswered", seq: 2, fixtureNamespace: "ns2", worldMs: FRI });
    expect(back.state).toMatchObject({ phase: "ready", worldMs: FRI, visit: { fixtureNamespace: "ns2" } });
  });

  it("an unconfirmed start over is not accepted", () => {
    expect(visitStep(ready(), { kind: "startOverConfirmed", inCall: false }).commands).toEqual([]);
  });

  it("the badge shows while the shown clock differs from the real one, and only then", () => {
    expect(visitBadge(INITIAL_VISIT, THU, "UTC").simulated).toBe(false);
    expect(visitBadge(ready(), THU, "UTC")).toEqual({ simulated: true, instantMs: FRI, zone: "UTC" });
    expect(visitBadge(ready(), FRI, "UTC").simulated).toBe(false);
  });
});
