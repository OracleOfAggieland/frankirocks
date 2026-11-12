import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createElectricityBudget, type ElectricityBudget } from "../electricity-budget";
import { HALF_DEG, OPEN_DEG, type Point, alongBlade } from "./switch-blade";
import { PIVOT, SPARK_MS, type SwitchCommand, type SwitchEvent, type SwitchState, switchInit, switchStep } from "./switch-machine";

/** A shell like the component's: answers `request` from a real budget, and records every command. */
class Rig {
  state: SwitchState;
  readonly log: SwitchCommand["kind"][] = [];
  constructor(
    reduced = false,
    readonly budget: ElectricityBudget = createElectricityBudget(),
  ) {
    this.state = switchInit(reduced);
  }
  send(...events: SwitchEvent[]): this {
    for (const e of events) {
      const { state, commands } = switchStep(this.state, e);
      this.state = state;
      for (const c of commands) {
        this.log.push(c.kind);
        if (c.kind === "request") this.send({ type: "granted", token: this.budget.request() });
        if (c.kind === "release") this.budget.release(c.token);
      }
    }
    return this;
  }
  count(kind: SwitchCommand["kind"]): number {
    return this.log.filter((k) => k === kind).length;
  }
  /** Frames every 16 ms from `t` until the phase leaves `phase`, or `limit` frames pass. Returns the last t. */
  runWhile(phase: SwitchState["phase"], t = 0, limit = 400): number {
    let now = t;
    for (let i = 0; i < limit && this.state.phase === phase; i++) {
      now += 16;
      this.send({ type: "frame", t: now });
    }
    return now;
  }
}

/** The handle's middle, in the viewBox, with the blade at `angle`. */
const handleAt = (angle: number): Point => alongBlade(PIVOT, angle, 140);
const grab = (at: Point, client: Point = { x: 0, y: 0 }): SwitchEvent => ({ type: "grab", id: 1, button: 0, onHandle: true, at, client });
const move = (at: Point, client: Point, buttonsUp = false): SwitchEvent => ({ type: "move", id: 1, at, client, buttonsUp });

describe("switch machine: the plain path", () => {
  it("rests open, unthrown, with no grant", () => {
    const s = switchInit(false);
    expect(s).toMatchObject({ phase: "open", angle: OPEN_DEG, thrown: false, token: null });
  });

  it("a click throws: the blade swings shut, meets the clips, sends thrown once, sparks, then goes", () => {
    const rig = new Rig().send({ type: "click" });
    expect(rig.state.phase).toBe("throw");
    expect(rig.count("thrown")).toBe(0);
    const t = rig.runWhile("throw");
    expect(rig.state.phase).toBe("spark");
    expect(rig.state.angle).toBe(0);
    expect(rig.count("thrown")).toBe(1);
    expect(rig.count("go")).toBe(0);
    expect(rig.state.token).not.toBeNull();
    expect(rig.budget.active()).toBe(1);
    rig.runWhile("spark", t);
    expect(rig.state.phase).toBe("go");
    expect(rig.count("thrown")).toBe(1);
    expect(rig.count("go")).toBe(1);
    expect(rig.budget.active()).toBe(0);
  });

  it("sparks for SPARK_MS of frame time, not a frame less", () => {
    const rig = new Rig().send({ type: "click" });
    const contact = rig.runWhile("throw");
    expect(rig.state.sparkStart).toBe(contact);
    rig.send({ type: "frame", t: contact + SPARK_MS - 1 });
    expect(rig.state.phase).toBe("spark");
    rig.send({ type: "frame", t: contact + SPARK_MS });
    expect(rig.state.phase).toBe("go");
  });

  it("under reduced motion a click goes at once: thrown, then go, with no spark and no grant asked", () => {
    const rig = new Rig(true).send({ type: "click" });
    expect(rig.state.phase).toBe("go");
    expect(rig.log.indexOf("thrown")).toBeLessThan(rig.log.indexOf("go"));
    expect(rig.count("request")).toBe(0);
    expect(rig.count("frame")).toBe(0);
  });

  it("reduced motion turning on mid-throw or mid-spark goes at once and gives the grant back", () => {
    const throwing = new Rig().send({ type: "click" }, { type: "frame", t: 16 });
    throwing.send({ type: "reduced", on: true });
    expect(throwing.state.phase).toBe("go");
    expect(throwing.count("thrown")).toBe(1);

    const sparking = new Rig().send({ type: "click" });
    sparking.runWhile("throw");
    expect(sparking.budget.active()).toBe(1);
    sparking.send({ type: "reduced", on: true });
    expect(sparking.state.phase).toBe("go");
    expect(sparking.budget.active()).toBe(0);
  });

  it("with the budget full, the spark runs without a grant (the still crackle) and still goes", () => {
    const budget = createElectricityBudget(0);
    const rig = new Rig(false, budget).send({ type: "click" });
    const t = rig.runWhile("throw");
    expect(rig.state.phase).toBe("spark");
    expect(rig.state.token).toBeNull();
    rig.runWhile("spark", t);
    expect(rig.state.phase).toBe("go");
  });

  it("a grant that comes outside the spark, or a second one, goes straight back", () => {
    const open = switchStep(switchInit(false), { type: "granted", token: 9 });
    expect(open.commands).toEqual([{ kind: "release", token: 9 }]);
    const rig = new Rig().send({ type: "click" });
    rig.runWhile("throw");
    const second = switchStep(rig.state, { type: "granted", token: 42 });
    expect(second.commands).toEqual([{ kind: "release", token: 42 }]);
    expect(second.state.token).toBe(rig.state.token);
  });

  it("unmount mid-spark gives the grant back and stops frames", () => {
    const rig = new Rig().send({ type: "click" });
    rig.runWhile("throw");
    rig.send({ type: "unmount" });
    expect(rig.budget.active()).toBe(0);
    expect(rig.log.slice(-2).sort()).toEqual(["release", "stopFrames"]);
  });
});

describe("switch machine: dragging the handle", () => {
  it("a drag past halfway throws on release, and the click that follows does nothing more", () => {
    const rig = new Rig().send(grab(handleAt(OPEN_DEG)), move(handleAt(HALF_DEG - 4), { x: 30, y: 0 }));
    expect(rig.state.phase).toBe("drag");
    expect(rig.state.angle).toBeCloseTo(HALF_DEG - 4, 5);
    rig.send({ type: "release", id: 1 });
    expect(rig.state.phase).toBe("throw");
    rig.send({ type: "click" });
    expect(rig.state.phase).toBe("throw");
    expect(rig.state.suppressClick).toBe(false);
  });

  it("a drag short of halfway settles back on release, and the click that follows does not throw", () => {
    const rig = new Rig().send(grab(handleAt(OPEN_DEG)), move(handleAt(HALF_DEG + 6), { x: 20, y: 0 }), { type: "release", id: 1 }, { type: "click" });
    expect(rig.state.phase).toBe("open");
    rig.runWhile("open");
    expect(rig.state.angle).toBe(OPEN_DEG);
    expect(rig.count("thrown")).toBe(0);
  });

  it("a tap on the handle, with no travel, leaves the click to throw", () => {
    const rig = new Rig().send(grab(handleAt(OPEN_DEG)), move(handleAt(OPEN_DEG - 1), { x: 1, y: 1 }), { type: "release", id: 1 });
    expect(rig.state.angle).toBe(OPEN_DEG);
    rig.send({ type: "click" });
    expect(rig.state.phase).toBe("throw");
  });

  it("a press off the handle, or not the main button, starts no drag", () => {
    expect(switchStep(switchInit(false), { ...grab(handleAt(OPEN_DEG)), onHandle: false } as SwitchEvent).state.phase).toBe("open");
    expect(switchStep(switchInit(false), { ...grab(handleAt(OPEN_DEG)), button: 2 } as SwitchEvent).state.phase).toBe("open");
  });

  it("lost capture, or a mouse moving with no button down, cancels the drag and lets the click throw again", () => {
    const lost = new Rig().send(grab(handleAt(OPEN_DEG)), move(handleAt(HALF_DEG - 4), { x: 30, y: 0 }), { type: "cancel", id: 1 });
    expect(lost.state.phase).toBe("open");
    expect(lost.state.drag).toBeNull();
    lost.send({ type: "click" });
    expect(lost.state.phase).toBe("throw");

    const up = new Rig().send(grab(handleAt(OPEN_DEG)), move(handleAt(HALF_DEG - 4), { x: 30, y: 0 }), move(handleAt(5), { x: 60, y: 0 }, true));
    expect(up.state.phase).toBe("open");
    expect(up.state.angle).toBeCloseTo(HALF_DEG - 4, 5);
    up.send({ type: "click" });
    expect(up.state.phase).toBe("throw");
  });

  it("a cancel after a normal release changes nothing", () => {
    const rig = new Rig().send(grab(handleAt(OPEN_DEG)), move(handleAt(HALF_DEG + 6), { x: 20, y: 0 }), { type: "release", id: 1 });
    const before = rig.state;
    rig.send({ type: "cancel", id: 1 });
    expect(rig.state).toBe(before);
  });
});

describe("switch machine: for every sequence of events", () => {
  const point = fc.record({ x: fc.double({ min: -50, max: 300, noNaN: true }), y: fc.double({ min: -50, max: 300, noNaN: true }) });
  const id = fc.constantFrom(1, 2);
  const event: fc.Arbitrary<SwitchEvent | { type: "advance"; dt: number }> = fc.oneof(
    fc.constant({ type: "click" } as const),
    fc.constant({ type: "clickSettled" } as const),
    fc.record({ type: fc.constant("grab" as const), id, button: fc.constantFrom(0, 0, 2), onHandle: fc.boolean(), at: point, client: point }),
    fc.record({ type: fc.constant("move" as const), id, at: point, client: point, buttonsUp: fc.boolean() }),
    fc.record({ type: fc.constant("release" as const), id }),
    fc.record({ type: fc.constant("cancel" as const), id }),
    fc.record({ type: fc.constant("near" as const), key: fc.constantFrom("hovered" as const, "focused" as const), on: fc.boolean() }),
    fc.record({ type: fc.constant("reduced" as const), on: fc.boolean() }),
    fc.record({ type: fc.constant("advance" as const), dt: fc.integer({ min: 0, max: 400 }) }),
  );

  /** Runs `events` (with frame times rising by each advance), then frames until nothing more can move. */
  function run(events: readonly (SwitchEvent | { type: "advance"; dt: number })[], reduced: boolean) {
    const rig = new Rig(reduced);
    let t = 0;
    for (const e of events) {
      if (e.type === "advance") {
        t += e.dt;
        rig.send({ type: "frame", t });
      } else rig.send(e);
    }
    return { rig, t };
  }

  it("sends thrown at most once, go at most once, and go only after thrown", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 60 }), fc.boolean(), (events, reduced) => {
        const { rig } = run(events, reduced);
        expect(rig.count("thrown")).toBeLessThanOrEqual(1);
        expect(rig.count("go")).toBeLessThanOrEqual(1);
        if (rig.count("go") === 1) expect(rig.log.indexOf("thrown")).toBeLessThan(rig.log.indexOf("go"));
        if (rig.state.phase === "spark" || rig.state.phase === "go") expect(rig.state.thrown).toBe(true);
      }),
    );
  });

  it("holds a grant only while sparking, and none once gone or unmounted", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 60 }), fc.boolean(), (events, reduced) => {
        const { rig } = run(events, reduced);
        expect(rig.budget.active()).toBe(rig.state.phase === "spark" && rig.state.token !== null ? 1 : 0);
        rig.send({ type: "unmount" });
        expect(rig.budget.active()).toBe(0);
      }),
    );
  });

  it("keeps the blade between closed and open", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 60 }), (events) => {
        const { rig } = run(events, false);
        expect(rig.state.angle).toBeGreaterThanOrEqual(0);
        expect(rig.state.angle).toBeLessThanOrEqual(OPEN_DEG);
      }),
    );
  });

  it("never throws from the click that follows a drag's release", () => {
    fc.assert(
      fc.property(fc.double({ min: HALF_DEG + 0.5, max: OPEN_DEG, noNaN: true }), fc.integer({ min: 5, max: 200 }), (angle, travel) => {
        const rig = new Rig().send(grab(handleAt(OPEN_DEG)), move(handleAt(angle), { x: travel, y: 0 }), { type: "release", id: 1 }, { type: "click" });
        expect(rig.state.phase).toBe("open");
        expect(rig.count("thrown")).toBe(0);
      }),
    );
  });

  it("once thrown, goes after SPARK_MS of frames under motion, or at once under reduced motion", () => {
    fc.assert(
      fc.property(fc.boolean(), (reduced) => {
        const rig = new Rig(reduced).send({ type: "click" });
        const t = rig.runWhile("throw");
        rig.runWhile("spark", t);
        expect(rig.state.phase).toBe("go");
        expect(rig.count("thrown")).toBe(1);
        expect(rig.count("go")).toBe(1);
      }),
    );
  });
});
