// The ring spark's transitions (brief 014, B3; lab-ui-foundation R10.3, R10.4), run through the shell
// CallScreen runs, against a real budget.
import { describe, expect, it } from "vitest";
import { RingSparkShell } from "../components/CallScreen";
import { createElectricityBudget, type ElectricityBudget } from "./electricity-budget";
import { RING_SPARK_IDLE, type RingSpark, type RingSparkEvent, ringSparkPropEvents, ringSparkStep } from "./ring-spark";

const press: RingSparkEvent = { type: "pressed", start: true, reduced: false };

/** Sends `events` through the real shell and returns where it ends. */
function send(shell: RingSparkShell, events: readonly RingSparkEvent[]): RingSpark {
  for (const e of events) shell.dispatch(e);
  return shell.getSnapshot();
}

/** A fresh shell, idle, on `budget`. */
const idleOn = (budget: ElectricityBudget) => new RingSparkShell(budget);

/** A spark playing on a fresh budget: one grant held. */
function sparking(): { budget: ElectricityBudget; shell: RingSparkShell; state: RingSpark & { mode: "sparking" } } {
  const budget = createElectricityBudget();
  const shell = idleOn(budget);
  const state = send(shell, [press]);
  if (state.mode !== "sparking") throw new Error("setup: the press did not spark");
  return { budget, shell, state };
}

describe("ring spark: the plain path", () => {
  it("IDLE + pressed -> SPARKING (start form, motion on, a grant is free)", () => {
    expect(ringSparkStep(RING_SPARK_IDLE, press)).toEqual({ state: RING_SPARK_IDLE, commands: [{ kind: "request" }] });
    const { budget, state } = sparking();
    expect(state).toEqual({ mode: "sparking", token: 1 });
    expect(budget.active()).toBe(1);
  });

  it("SPARKING + animationEnd -> IDLE (the spark ran once; its grant goes back)", () => {
    const { budget, shell, state } = sparking();
    expect(send(shell, [{ type: "animationEnd", token: state.token }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });

  it("SPARKING + animationEnd of another token -> SPARKING (an end names its spark)", () => {
    const { budget, shell, state } = sparking();
    expect(send(shell, [{ type: "animationEnd", token: state.token + 1 }])).toEqual(state);
    expect(budget.active()).toBe(1);
  });

  it("SPARKING + animationCancel of another token -> SPARKING (a cancel names its spark)", () => {
    const { budget, shell, state } = sparking();
    expect(send(shell, [{ type: "animationCancel", token: state.token + 1 }])).toEqual(state);
    expect(budget.active()).toBe(1);
  });

  it("SPARKING + pressed -> SPARKING (one spark at a time; no second grant)", () => {
    const { budget, shell, state } = sparking();
    expect(ringSparkStep(state, press)).toEqual({ state, commands: [] });
    expect(send(shell, [press])).toEqual(state);
    expect(budget.active()).toBe(1);
  });

  it("SPARKING + granted -> SPARKING (a stray second grant goes straight back)", () => {
    const { budget, shell, state } = sparking();
    const stray = budget.request();
    if (stray === null) throw new Error("setup: the budget gave no second grant");
    expect(ringSparkStep(state, { type: "granted", token: stray })).toEqual({ state, commands: [{ kind: "release", token: stray }] });
    shell.dispatch({ type: "granted", token: stray });
    expect(shell.getSnapshot()).toEqual(state);
    expect(budget.active()).toBe(1);
    // The grant still held is the spark's own, so ending the spark leaves nothing held.
    shell.dispatch({ type: "animationEnd", token: state.token });
    expect(budget.active()).toBe(0);
  });

  it("IDLE + pressed -> IDLE (the budget is full: no spark, nothing held)", () => {
    const budget = createElectricityBudget();
    budget.request();
    budget.request();
    expect(send(idleOn(budget), [press])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(2);
  });

  it("IDLE + pressed on the hang-up form -> IDLE (only the start ring sparks)", () => {
    const budget = createElectricityBudget();
    expect(send(idleOn(budget), [{ type: "pressed", start: false, reduced: false }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });

  it("IDLE + every exit -> IDLE (nothing held, nothing released)", () => {
    const budget = createElectricityBudget();
    // Another holder's grant, with the token the exits name: it is not the idle spark's to give back.
    expect(budget.request()).toBe(1);
    const exits: RingSparkEvent[] = [
      { type: "animationEnd", token: 1 },
      { type: "animationCancel", token: 1 },
      { type: "formLeft" },
      { type: "reducedOn" },
      { type: "unmount" },
    ];
    for (const e of exits) expect(ringSparkStep(RING_SPARK_IDLE, e)).toEqual({ state: RING_SPARK_IDLE, commands: [] });
    expect(send(idleOn(budget), exits)).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(1);
  });

  it("an unknown event changes nothing and does not throw", () => {
    const { state } = sparking();
    for (const s of [RING_SPARK_IDLE, state]) expect(ringSparkStep(s, { type: "nope" } as never)).toEqual({ state: s, commands: [] });
  });
});

describe("ring spark: reduced motion", () => {
  it("IDLE + pressed with reduced motion -> IDLE (no spark under Reduced_Motion; no grant asked)", () => {
    const budget = createElectricityBudget();
    expect(ringSparkStep(RING_SPARK_IDLE, { type: "pressed", start: true, reduced: true })).toEqual({ state: RING_SPARK_IDLE, commands: [] });
    expect(send(idleOn(budget), [{ type: "pressed", start: true, reduced: true }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });

  it("SPARKING + reducedOn -> IDLE, grant released (the animation is gone, so no end will come)", () => {
    const { budget, shell } = sparking();
    expect(send(shell, [{ type: "reducedOn" }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });
});

describe("ring spark: every way a spark can end gives its grant back", () => {
  it("SPARKING + formLeft -> IDLE, grant released (the click started a call and the span is gone)", () => {
    const { budget, shell } = sparking();
    expect(send(shell, [{ type: "formLeft" }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });

  it("SPARKING + animationCancel -> IDLE (a cancelled animation ends the spark like a finished one)", () => {
    const { budget, shell, state } = sparking();
    expect(send(shell, [{ type: "animationCancel", token: state.token }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });

  it("SPARKING + unmount -> IDLE, grant released (sign-out swaps the screen before the spark ends)", () => {
    const { budget, shell } = sparking();
    expect(send(shell, [{ type: "unmount" }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });
});

describe("ring spark: what a render's props send", () => {
  it("the start form with motion on sends nothing", () => {
    expect(ringSparkPropEvents(true, false)).toEqual([]);
  });

  it("the hang-up form sends formLeft, Reduced_Motion on sends reducedOn, and both send both", () => {
    expect(ringSparkPropEvents(false, false)).toEqual([{ type: "formLeft" }]);
    expect(ringSparkPropEvents(true, true)).toEqual([{ type: "reducedOn" }]);
    expect(ringSparkPropEvents(false, true)).toEqual([{ type: "formLeft" }, { type: "reducedOn" }]);
  });

  it("a spark playing when the props change gives its grant back; sending the events again changes nothing", () => {
    for (const [start, reduced] of [
      [false, false],
      [true, true],
      [false, true],
    ] as const) {
      const { budget, shell } = sparking();
      const events = ringSparkPropEvents(start, reduced);
      expect(send(shell, [...events, ...events])).toEqual(RING_SPARK_IDLE);
      expect(budget.active()).toBe(0);
    }
  });
});

describe("ring spark: the shell", () => {
  it("asks the budget for each spark's grant and keys the spark by the token it was given", () => {
    const budget = createElectricityBudget();
    expect(budget.request()).toBe(1);
    const shell = new RingSparkShell(budget);
    shell.dispatch(press);
    expect(shell.getSnapshot()).toEqual({ mode: "sparking", token: 2 });
    expect(budget.active()).toBe(2);
    shell.dispatch({ type: "animationEnd", token: 2 });
    expect(budget.active()).toBe(1);
  });

  it("tells its listeners when the spark starts and ends, and only then", () => {
    const shell = new RingSparkShell(createElectricityBudget());
    let told = 0;
    const unsubscribe = shell.subscribe(() => {
      told += 1;
    });
    shell.dispatch({ type: "formLeft" });
    expect(told).toBe(0);
    shell.dispatch(press);
    expect(told).toBe(1);
    shell.dispatch(press);
    expect(told).toBe(1);
    shell.dispatch({ type: "unmount" });
    expect(told).toBe(2);
    unsubscribe();
    shell.dispatch(press);
    expect(told).toBe(2);
  });

  it("a full budget leaves the shell idle, with the same snapshot", () => {
    const budget = createElectricityBudget();
    budget.request();
    budget.request();
    const shell = new RingSparkShell(budget);
    const before = shell.getSnapshot();
    shell.dispatch(press);
    expect(shell.getSnapshot()).toBe(before);
    expect(budget.active()).toBe(2);
  });
});
