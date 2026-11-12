import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LEGS, MIN_REACH, REACH, dist, hipOffset, solveLeg, sub } from "./geometry";
import { GALLOP_SPEED, GROUPS, groupOf, hipAt } from "./gait";
import { type SpiderInput, type SpiderState, initialSpider, spiderPose, stepSpider } from "./spider";

interface Move {
  dt: number;
  dx: number;
  dy: number;
  touch: boolean;
  text: boolean;
  pressed: boolean;
}

/** Runs a pointer path through the spider and hands every state to `check`. */
function run(moves: readonly Move[], check?: (s: SpiderState, input: SpiderInput) => void): SpiderState[] {
  let s = initialSpider;
  let t = 1000;
  let x = 400;
  let y = 300;
  const states: SpiderState[] = [];
  for (const m of moves) {
    t += m.dt;
    x += m.dx;
    y += m.dy;
    const input: SpiderInput = { t, x, y, present: true, touch: m.touch, text: m.text, pressed: m.pressed };
    s = stepSpider(s, input);
    states.push(s);
    check?.(s, input);
  }
  return states;
}

const arbDt = fc.integer({ min: 4, max: 40 });
/** Any path, including fast flicks and big jumps. */
const arbMove: fc.Arbitrary<Move> = fc.record({
  dt: arbDt,
  dx: fc.double({ min: -90, max: 90, noNaN: true }),
  dy: fc.double({ min: -90, max: 90, noNaN: true }),
  touch: fc.boolean(),
  text: fc.boolean(),
  pressed: fc.boolean(),
});
/** Paths whose raw speed, plus the text sidestep's own motion, stays under the gallop speed. */
const arbSlow: fc.Arbitrary<Move> = arbDt.chain((dt) =>
  fc.record({
    dt: fc.constant(dt),
    dx: fc.double({ min: -1, max: 1, noNaN: true }).map((k) => k * dt),
    dy: fc.double({ min: -1, max: 1, noNaN: true }).map((k) => k * dt),
    touch: fc.boolean(),
    text: fc.boolean(),
    pressed: fc.boolean(),
  }),
);

describe("Lab spider gait properties", () => {
  it("feet never leave their reach, in the gait and in the drawing", () => {
    fc.assert(
      fc.property(fc.array(arbMove, { minLength: 1, maxLength: 120 }), (moves) => {
        run(moves, (s) => {
          const body = s.origin;
          expect(body).not.toBeNull();
          if (body === null) return;
          s.gait.feet.forEach((foot, leg) => {
            const d = dist(foot.at, hipAt(body, leg, s.heading));
            expect(d).toBeGreaterThanOrEqual(MIN_REACH - 1e-6);
            expect(d).toBeLessThanOrEqual(REACH + 1e-6);
          });
          for (const leg of spiderPose(s).legs) {
            const d = dist(leg.hip, leg.foot);
            expect(d).toBeGreaterThanOrEqual(MIN_REACH - 1e-6);
            expect(d).toBeLessThanOrEqual(REACH + 1e-6);
          }
        });
      }),
      { numRuns: 200 },
    );
  });

  it("the two groups never swing together below the gallop speed", () => {
    fc.assert(
      fc.property(fc.array(arbSlow, { minLength: 1, maxLength: 160 }), (moves) => {
        run(moves, (s) => {
          expect(Math.hypot(s.velocity.x, s.velocity.y)).toBeLessThanOrEqual(GALLOP_SPEED);
          const swinging = GROUPS.map((g) => g.some((leg) => s.gait.feet[leg].swing !== null));
          expect(swinging[0] && swinging[1]).toBe(false);
        });
      }),
      { numRuns: 200 },
    );
  });

  it("at any speed, groups overlap only when the later one lifted in a gallop, and a group lifts as one", () => {
    fc.assert(
      fc.property(fc.array(arbMove, { minLength: 1, maxLength: 120 }), (moves) => {
        run(moves, (s) => {
          const [a, b] = s.gait.groups;
          if (a !== null && b !== null) {
            const later = a.start >= b.start ? a : b;
            expect(later.overlapped).toBe(true);
          }
          s.gait.feet.forEach((foot, leg) => {
            const g = s.gait.groups[groupOf(leg)];
            if (foot.swing !== null) {
              expect(g).not.toBeNull();
              expect(foot.swing.start).toBe(g?.start);
            }
          });
        });
      }),
      { numRuns: 200 },
    );
  });

  it("the same input sequence gives the same output", () => {
    fc.assert(
      fc.property(fc.array(arbMove, { minLength: 1, maxLength: 80 }), (moves) => {
        const a = run(moves);
        const b = run(moves);
        expect(b).toEqual(a);
        expect(b.map(spiderPose)).toEqual(a.map(spiderPose));
      }),
      { numRuns: 100 },
    );
  });
});

describe("Lab spider gait", () => {
  const steady = (n: number, dx: number, dt = 16): Move[] => Array.from({ length: n }, () => ({ dt, dx, dy: 0, touch: false, text: false, pressed: false }));

  it("planted feet stay put in the viewport while the body moves, unless the body has outrun the leg", () => {
    const states = run(steady(40, 0.6));
    let held = 0;
    for (let i = 1; i < states.length; i++) {
      for (let leg = 0; leg < LEGS; leg++) {
        const before = states[i - 1].gait.feet[leg];
        const now = states[i].gait.feet[leg];
        const body = states[i].origin;
        if (body === null) continue;
        const stretched = dist(now.at, hipAt(body, leg, states[i].heading)) >= REACH - 1e-6;
        if (before.swing === null && now.swing === null && !stretched) {
          expect(now.at).toEqual(before.at);
          held++;
        }
      }
    }
    expect(held).toBeGreaterThan(100);
  });

  it("walking steadily along its heading, the two groups take turns", () => {
    const states = run(Array.from({ length: 120 }, () => ({ dt: 16, dx: 0, dy: -1.2, touch: false, text: false, pressed: false })));
    const lifts: number[] = [];
    for (let i = 1; i < states.length; i++) {
      for (const g of [0, 1] as const) {
        const before = states[i - 1].gait.groups[g];
        const now = states[i].gait.groups[g];
        if (now !== null && (before === null || before.start !== now.start)) lifts.push(g);
      }
    }
    expect(lifts.length).toBeGreaterThan(4);
    for (let i = 1; i < lifts.length; i++) expect(lifts[i]).not.toBe(lifts[i - 1]);
  });

  it("a step takes 80 ms, and 50 ms above the gallop speed", () => {
    const walk = run(steady(60, 0.8)).flatMap((s) => s.gait.groups.filter((g) => g !== null));
    expect(walk.length).toBeGreaterThan(0);
    expect(walk.every((g) => g?.dur === 80)).toBe(true);
    const gallop = run(steady(60, 2.4 * 16)).slice(10).flatMap((s) => s.gait.groups.filter((g) => g !== null));
    expect(gallop.length).toBeGreaterThan(0);
    expect(gallop.every((g) => g?.dur === 50)).toBe(true);
  });

  it("a fast move is not a jump: at 3.5 px per ms on 60 Hz frames the heading turns and feet lift", () => {
    const states = run(steady(40, 3.5 * 16.7, 16.7));
    const last = states[states.length - 1];
    expect(Math.abs(last.heading)).toBeLessThan(0.2);
    expect(Math.hypot(last.velocity.x, last.velocity.y)).toBeGreaterThan(GALLOP_SPEED);
    const lifted = states.slice(5).some((s) => s.gait.feet.some((f) => f.swing !== null));
    expect(lifted).toBe(true);
  });

  it("a planted foot's knee stays on one side of the hip-to-foot line while the body moves past it", () => {
    const states = run(steady(60, 0.2 * 16, 16));
    let checked = 0;
    for (let i = 1; i < states.length; i++) {
      const a = states[i - 1];
      const b = states[i];
      if (a.origin === null || b.origin === null) continue;
      for (let leg = 0; leg < LEGS; leg++) {
        const fa = a.gait.feet[leg];
        const fb = b.gait.feet[leg];
        if (fa.swing !== null || fb.swing !== null || fa.at.x !== fb.at.x || fa.at.y !== fb.at.y) continue;
        const side = (s: typeof a) => {
          if (s.origin === null) return 0;
          const hip = hipOffset(leg, s.heading);
          const foot = sub(s.gait.feet[leg].at, s.origin);
          const { knee } = solveLeg(hip, foot, s.heading, leg);
          return Math.sign((foot.x - hip.x) * (knee.y - hip.y) - (foot.y - hip.y) * (knee.x - hip.x));
        };
        expect(side(b)).toBe(side(a));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("standing still, every foot comes to rest planted", () => {
    const states = run([...steady(30, 1), ...steady(40, 0)]);
    const last = states[states.length - 1];
    expect(last.gait.feet.every((f) => f.swing === null)).toBe(true);
    expect(last.gait.groups).toEqual([null, null]);
  });
});
