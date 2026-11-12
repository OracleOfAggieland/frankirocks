import { describe, expect, it } from "vitest";
import { PROACTIVE_ANSWER } from "../../app/specimens/_fixtures/visit";
import { BARRIER_WAIT_MS, INITIAL_VISIT, type VisitEvent, type VisitState, badgeFor, boltEnabled, inputAllowed, visitBadge, visitStep } from "./visit-machine";

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
    const retried = run([{ kind: "retry", newVisitId: "v3" }], s);
    expect(retried.s.phase).toBe("cloning");
    expect(retried.commands.at(-1)).toEqual({ kind: "reset", seq: 1, visitId: "v3" });
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
    const go = visitStep(asked, { kind: "startOverConfirmed", inCall: false, newVisitId: "v2" });
    expect(go.state.phase).toBe("resetting");
    expect(go.commands).toEqual([{ kind: "store", visit: { visitId: "v2", fixtureNamespace: null, worldClockMs: null } }, { kind: "reset", seq: 2, visitId: "v2" }]);
  });

  it("a start over during a call ends the call first", () => {
    const asked = visitStep(ready(), { kind: "startOverAsked" }).state;
    const go = visitStep(asked, { kind: "startOverConfirmed", inCall: true, newVisitId: "v2" });
    expect(go.state).toMatchObject({ phase: "resetting", endingCall: true });
    expect(go.commands.map((c) => c.kind)).toEqual(["store", "endCall"]);
    const ended = visitStep(go.state, { kind: "callEnded" });
    expect(ended.commands).toEqual([{ kind: "reset", seq: 2, visitId: "v2" }]);
    const back = visitStep(ended.state, { kind: "resetAnswered", seq: 2, fixtureNamespace: "ns2", worldMs: FRI });
    expect(back.state).toMatchObject({ phase: "ready", worldMs: FRI, visit: { fixtureNamespace: "ns2" } });
  });

  it("an unconfirmed start over is not accepted", () => {
    expect(visitStep(ready(), { kind: "startOverConfirmed", inCall: false, newVisitId: "v2" }).commands).toEqual([]);
  });

  it("the badge shows while the shown clock differs from the real one, and only then", () => {
    expect(visitBadge(INITIAL_VISIT, THU, "UTC").simulated).toBe(false);
    expect(visitBadge(ready(), THU, "UTC")).toEqual({ simulated: true, instantMs: FRI, zone: "UTC" });
    expect(visitBadge(ready(), FRI, "UTC").simulated).toBe(false);
  });

  // Brief 038 finding 1.
  it("a LIVE answer is the live phase, stored so a reload is live at once and asks nothing", () => {
    const { s, commands } = run([{ kind: "entered", stored: null, newVisitId: "v1" }, { kind: "resetFailed", seq: 1, why: "live" }]);
    expect(s).toMatchObject({ phase: "live", worldMs: null, failure: null });
    expect(commands.at(-1)).toEqual({ kind: "store", visit: { visitId: "v1", fixtureNamespace: null, worldClockMs: null, live: true } });
    const again = run([{ kind: "entered", stored: { visitId: "v1", fixtureNamespace: null, worldClockMs: null, live: true }, newVisitId: "v2" }]);
    expect(again.s.phase).toBe("live");
    expect(again.commands).toEqual([]);
    // No start over and no bolt on a real account.
    expect(visitStep(s, { kind: "startOverAsked" }).state.confirming).toBe(false);
    expect(boltEnabled(s)).toBe(false);
  });

  it("the screen takes input only once the server has said which account this is", () => {
    const cloning = run([{ kind: "entered", stored: null, newVisitId: "v1" }]).s;
    const failed = visitStep(cloning, { kind: "resetFailed", seq: 1, why: "timeout" }).state;
    const live = visitStep(cloning, { kind: "resetFailed", seq: 1, why: "live" }).state;
    const resetting = visitStep(visitStep(ready(), { kind: "startOverAsked" }).state, { kind: "startOverConfirmed", inCall: false, newVisitId: "v2" }).state;
    expect([INITIAL_VISIT, cloning, failed, resetting].map(inputAllowed)).toEqual([false, false, false, false]);
    expect([ready(), live].map(inputAllowed)).toEqual([true, true]);
  });

  // Brief 038 finding 4.
  it("a STALE answer reloads the visit: another tab's newer clone is taken up and the old screen dropped", () => {
    const pressed = visitStep(ready(), { kind: "boltPressed", toMs: THU });
    const newer = { visitId: "v9", fixtureNamespace: "ns9", worldClockMs: THU };
    const out = visitStep(pressed.state, { kind: "staleVisit", seq: pressed.state.seq, stored: newer });
    expect(out.state).toMatchObject({ phase: "ready", visit: newer, worldMs: THU, bolt: "idle" });
    expect(out.commands).toEqual([{ kind: "afterReset" }]);
  });

  it("a STALE answer with nothing newer stored ends the visit: Try again makes a new one", () => {
    const s = ready();
    const out = visitStep(s, { kind: "staleVisit", seq: null, stored: s.visit });
    expect(out.state).toMatchObject({ phase: "failed", failure: "interrupted", worldMs: null });
    expect(inputAllowed(out.state)).toBe(false);
    const again = visitStep(out.state, { kind: "retry", newVisitId: "v5" });
    expect(again.commands.at(-1)).toEqual({ kind: "reset", seq: again.state.seq, visitId: "v5" });
  });

  // Brief 038 finding 5.
  it("the screen's clock: none until the server has said, the world clock on a clone, the real clock on a live account", () => {
    expect(badgeFor(INITIAL_VISIT, THU, "UTC")).toBeNull();
    const cloning = run([{ kind: "entered", stored: null, newVisitId: "v1" }]).s;
    expect(badgeFor(cloning, THU, "UTC")).toBeNull();
    expect(badgeFor(ready(), THU, "UTC")).toEqual({ simulated: true, instantMs: FRI, zone: "UTC" });
    // Simulated even when the world clock happens to equal the real one.
    expect(badgeFor(ready(), FRI, "UTC")).toEqual({ simulated: true, instantMs: FRI, zone: "UTC" });
    const resetting = visitStep(visitStep(ready(), { kind: "startOverAsked" }).state, { kind: "startOverConfirmed", inCall: false, newVisitId: "v2" }).state;
    expect(badgeFor(resetting, THU, "UTC")).toBeNull();
    const failed = run([{ kind: "entered", stored: null, newVisitId: "v1" }, { kind: "resetFailed", seq: 1, why: "timeout" }]).s;
    expect(badgeFor(failed, THU, "UTC")).toBeNull();
    const live = run([{ kind: "entered", stored: null, newVisitId: "v1" }, { kind: "resetFailed", seq: 1, why: "live" }]).s;
    expect(badgeFor(live, THU, "UTC")).toEqual({ simulated: false, instantMs: THU, zone: "UTC" });
  });
});
