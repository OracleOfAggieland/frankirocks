// The ring spark's transitions (brief 014, B3; lab-ui-foundation R10.3, R10.4), run against a real budget.
import { describe, expect, it } from "vitest";
import { createElectricityBudget, type ElectricityBudget } from "./electricity-budget";
import { RING_SPARK_IDLE, type RingSpark, type RingSparkEvent, ringSparkStep } from "./ring-spark";

/** The shell's loop, as CallScreen runs it: step, then run each command against the budget. */
function drive(budget: ElectricityBudget, state: RingSpark, events: readonly RingSparkEvent[]): RingSpark {
  let s = state;
  const run = (e: RingSparkEvent) => {
    const r = ringSparkStep(s, e);
    s = r.state;
    for (const c of r.commands) {
      if (c.kind === "request") run({ type: "granted", token: budget.request() });
      else budget.release(c.token);
    }
  };
  for (const e of events) run(e);
  return s;
}

const press: RingSparkEvent = { type: "pressed", start: true, reduced: false };

/** A spark playing on a fresh budget: one grant held. */
function sparking(): { budget: ElectricityBudget; state: RingSpark & { mode: "sparking" } } {
  const budget = createElectricityBudget();
  const state = drive(budget, RING_SPARK_IDLE, [press]);
  if (state.mode !== "sparking") throw new Error("setup: the press did not spark");
  return { budget, state };
}

describe("ring spark: the plain path", () => {
  it("IDLE + pressed -> SPARKING (start form, motion on, a grant is free)", () => {
    const { budget, state } = sparking();
    expect(state.mode).toBe("sparking");
    expect(budget.active()).toBe(1);
  });

  it("SPARKING + animationEnd -> IDLE (the spark ran once; its grant goes back)", () => {
    const { budget, state } = sparking();
    expect(drive(budget, state, [{ type: "animationEnd", token: state.token }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });

  it("SPARKING + animationEnd of another token -> SPARKING (an end names its spark)", () => {
    const { budget, state } = sparking();
    expect(drive(budget, state, [{ type: "animationEnd", token: state.token + 1 }])).toEqual(state);
    expect(budget.active()).toBe(1);
  });

  it("SPARKING + animationCancel of another token -> SPARKING (a cancel names its spark)", () => {
    const { budget, state } = sparking();
    expect(drive(budget, state, [{ type: "animationCancel", token: state.token + 1 }])).toEqual(state);
    expect(budget.active()).toBe(1);
  });

  it("SPARKING + pressed -> SPARKING (one spark at a time; no second grant)", () => {
    const { budget, state } = sparking();
    expect(drive(budget, state, [press])).toEqual(state);
    expect(budget.active()).toBe(1);
  });

  it("SPARKING + granted -> SPARKING (a stray second grant goes straight back)", () => {
    const budget = createElectricityBudget();
    const state = drive(budget, RING_SPARK_IDLE, [press]);
    const stray = budget.request();
    expect(drive(budget, state, [{ type: "granted", token: stray }])).toEqual(state);
    expect(budget.active()).toBe(1);
  });

  it("IDLE + pressed -> IDLE (the budget is full: no spark, nothing held)", () => {
    const budget = createElectricityBudget();
    budget.request();
    budget.request();
    expect(drive(budget, RING_SPARK_IDLE, [press])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(2);
  });

  it("IDLE + pressed on the hang-up form -> IDLE (only the start ring sparks)", () => {
    const budget = createElectricityBudget();
    expect(drive(budget, RING_SPARK_IDLE, [{ type: "pressed", start: false, reduced: false }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });

  it("IDLE + every exit -> IDLE (nothing held, nothing released)", () => {
    const budget = createElectricityBudget();
    const exits: RingSparkEvent[] = [
      { type: "animationEnd", token: 1 },
      { type: "animationCancel", token: 1 },
      { type: "formLeft" },
      { type: "reducedOn" },
      { type: "unmount" },
    ];
    for (const e of exits) expect(ringSparkStep(RING_SPARK_IDLE, e)).toEqual({ state: RING_SPARK_IDLE, commands: [] });
    expect(budget.active()).toBe(0);
  });
});

describe("ring spark: reduced motion", () => {
  it("IDLE + pressed with reduced motion -> IDLE (no spark under Reduced_Motion; no grant asked)", () => {
    const budget = createElectricityBudget();
    expect(ringSparkStep(RING_SPARK_IDLE, { type: "pressed", start: true, reduced: true })).toEqual({ state: RING_SPARK_IDLE, commands: [] });
    expect(drive(budget, RING_SPARK_IDLE, [{ type: "pressed", start: true, reduced: true }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });

  it.fails("SPARKING + reducedOn -> IDLE, grant released (the animation is gone, so no end will come)", () => {
    const { budget, state } = sparking();
    expect(drive(budget, state, [{ type: "reducedOn" }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });
});

describe("ring spark: every way a spark can end gives its grant back", () => {
  it("SPARKING + formLeft -> IDLE, grant released (the click started a call and the span is gone)", () => {
    const { budget, state } = sparking();
    expect(drive(budget, state, [{ type: "formLeft" }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });

  it.fails("SPARKING + animationCancel -> IDLE (a cancelled animation ends the spark like a finished one)", () => {
    const { budget, state } = sparking();
    expect(drive(budget, state, [{ type: "animationCancel", token: state.token }])).toEqual(RING_SPARK_IDLE);
    expect(budget.active()).toBe(0);
  });

  it.fails("SPARKING + unmount -> grant released (sign-out swaps the screen before the spark ends)", () => {
    const { budget, state } = sparking();
    drive(budget, state, [{ type: "unmount" }]);
    expect(budget.active()).toBe(0);
  });
});
