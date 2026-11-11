// Pins three/math.ts (prototype franki.html 224-256) to the prototype's own numbers (brief 013 design note §8.1, WP1).
// Every literal below was computed by the prototype's functions, evaluated in node by the team's goldens tool, and is
// compared exactly: the port is the same arithmetic in the same order, so any difference is a changed line.
// The springs (Chan), smooth()'s inversion for e0 > e1 and the seeded streams decide the look and the acting:
// a change here changes every pose, every hair cell and every spark.
import { describe, expect, it } from "vitest";
import { Chan, angDist, clamp, createRandom, easeInOut, easeInQuad, easeOutCubic, gauss, lerp, mulberry32, smooth } from "./math";

/** The first ten values of each stream the prototype seeds (rnd, the brush texture, the motes, the hair). */
const PREFIXES: ReadonlyArray<readonly [string, number, readonly number[]]> = [
  ["0xF2A4C1 (rnd, behaviour)", 0xF2A4C1, [
    0.18666568538174033, 0.6429688562639058, 0.8590245926752687, 0.977016136283055, 0.6347064615692943,
    0.13158731814473867, 0.09236148884519935, 0.3844946895260364, 0.14610349969007075, 0.2555468862410635,
  ]],
  ["77 (brush texture)", 77, [
    0.4256013557314873, 0.0422197578009218, 0.6960067297331989, 0.48589822952635586, 0.1157626323401928,
    0.8261081855744123, 0.8831484974361956, 0.7839951508212835, 0.055966206127777696, 0.1807468815241009,
  ]],
  ["909 (dust motes)", 909, [
    0.896927616558969, 0.9710923430975527, 0.058211581548675895, 0.9784101974219084, 0.8586669436190277,
    0.5476409490220249, 0.33247598144225776, 0.7634191927500069, 0.6228211459238082, 0.13101535174064338,
  ]],
  ["4242 (hair)", 4242, [
    0.5467061335220933, 0.27860878920182586, 0.9312369171530008, 0.5072224664036185, 0.668778280261904,
    0.2878789729438722, 0.25968898204155266, 0.4014227974694222, 0.344154309714213, 0.5877229548059404,
  ]],
];

describe("mulberry32", () => {
  for (const [label, seed, values] of PREFIXES) {
    it(`gives the prototype's first ten values for seed ${label}`, () => {
      const r = mulberry32(seed);
      expect(Array.from({ length: 10 }, () => r())).toEqual(values);
    });
  }

  it("keeps one independent stream per call", () => {
    const a = mulberry32(4242), b = mulberry32(4242);
    a(); a(); a();
    expect(b()).toBe(0.5467061335220933);
    expect(a()).toBe(0.5072224664036185);
  });
});

describe("createRandom", () => {
  it("draws rnd from mulberry32(0xF2A4C1), as the prototype's one behaviour stream", () => {
    const { rnd } = createRandom();
    expect(Array.from({ length: 10 }, () => rnd())).toEqual(PREFIXES[0][2]);
  });

  it("gives every engine its own stream, so a second build does not continue the first", () => {
    const one = createRandom(), two = createRandom();
    one.rnd(); one.rnd();
    expect(two.rnd()).toBe(0.18666568538174033);
    expect(one.rnd()).toBe(0.8590245926752687);
  });

  it("maps rr(a, b) to a + (b - a) * rnd(), one draw per call", () => {
    const { rr } = createRandom();
    expect(rr(1.2, 2.6)).toBe(1.2 + (2.6 - 1.2) * 0.18666568538174033);
    expect(rr(-1, 1)).toBe(-1 + (1 - -1) * 0.6429688562639058);
  });
});

describe("Chan", () => {
  it("starts at rest on its value, with w 9 and z 1 by default", () => {
    const c = new Chan(0.3);
    expect({ v: c.v, t: c.t, vel: c.vel, w: c.w, z: c.z }).toEqual({ v: 0.3, t: 0.3, vel: 0, w: 9, z: 1 });
  });

  /** new Chan(v0, w, z), then t = target, then step(dt) per entry; the values after step n (1-based). */
  function run(v0: number, w: number | undefined, z: number | undefined, target: number, dts: readonly number[]) {
    const c = w === undefined ? new Chan(v0) : z === undefined ? new Chan(v0, w) : new Chan(v0, w, z);
    c.t = target;
    return dts.map((dt) => { c.step(dt); return { v: c.v, vel: c.vel }; });
  }
  const DT60 = Array.from({ length: 60 }, () => 1 / 60);
  const at = (list: { v: number; vel: number }[], n: number) => list[n - 1];

  it("steps the default critically damped spring exactly as the prototype", () => {
    const r = run(0, undefined, undefined, 1, DT60);
    expect(at(r, 1)).toEqual({ v: 0.022500000000000003, vel: 1.35 });
    expect(at(r, 2)).toEqual({ v: 0.06024375, vel: 2.264625 });
    expect(at(r, 5)).toEqual({ v: 0.21741119514931642, vel: 3.3739443675527347 });
    expect(at(r, 10)).toEqual({ v: 0.4859306935932253, vel: 2.9408803914293 });
    expect(at(r, 30)).toEqual({ v: 0.9342339023705363, vel: 0.4446906158430326 });
    expect(at(r, 60)).toEqual({ v: 0.9973837688059647, vel: 0.01784257446122495 });
  });

  it("steps the upper lid's spring (w 16) exactly as the prototype", () => {
    const r = run(0.08, 16, undefined, 0.28, DT60);
    expect(at(r, 1)).toEqual({ v: 0.09422222222222222, vel: 0.8533333333333334 });
    expect(at(r, 2)).toEqual({ v: 0.11407012345679013, vel: 1.1908740740740742 });
    expect(at(r, 5)).toEqual({ v: 0.17352699945758404, vel: 1.0958693789959661 });
    expect(at(r, 10)).toEqual({ v: 0.23426347456750868, vel: 0.5163014246061681 });
    expect(at(r, 30)).toEqual({ v: 0.27859554617576676, vel: 0.01605085063184 });
    expect(at(r, 60)).toEqual({ v: 0.279992485735614, vel: 0.00008587730726771635 });
  });

  it("steps the nod's underdamped spring (w 14, z 0.55) through its overshoot exactly as the prototype", () => {
    const r = run(0, 14, 0.55, 1, DT60);
    expect(at(r, 1)).toEqual({ v: 0.05444444444444444, vel: 3.2666666666666666 });
    expect(at(r, 2)).toEqual({ v: 0.14639506172839506, vel: 5.517037037037037 });
    expect(at(r, 5)).toEqual({ v: 0.5135238545106606, vel: 7.603785545902555 });
    expect(at(r, 10)).toEqual({ v: 0.9826150190885611, vel: 3.818938613829806 });
    expect(at(r, 30)).toEqual({ v: 0.9898033548519556, vel: -0.04141455962835351 });
    expect(at(r, 60)).toEqual({ v: 0.9999025332229983, vel: -0.0009507560643174738 });
  });

  it("steps the gaze's stiff spring (w 55, z 0.8) exactly as the prototype", () => {
    const r = run(0, 55, 0.8, -0.4, DT60);
    expect(at(r, 1)).toEqual({ v: -0.33611111111111114, vel: -20.166666666666668 });
    expect(at(r, 2)).toEqual({ v: -0.23294367283950623, vel: 6.190046296296295 });
    expect(at(r, 5)).toEqual({ v: -0.4359670223940675, vel: -7.230860626998101 });
    expect(at(r, 10)).toEqual({ v: -0.37660078626130855, vel: 2.924377146929869 });
    expect(at(r, 30)).toEqual({ v: -0.3990415049880707, vel: 0.1248797824627737 });
    expect(at(r, 60)).toEqual({ v: -0.3999916886331301, vel: 0.0010828721541087582 });
  });

  it("keeps the semi-implicit Euler step at uneven frame times, up to the loop's 0.05 s cap (the mouth's w 40)", () => {
    const r = run(1, 40, undefined, 0, [0, 1 / 60, 0.05, 0.033, 1 / 144, 0.05, 0.016, 0.02]);
    expect(r).toEqual([
      { v: 1, vel: 0 },
      { v: 0.5555555555555556, vel: -26.666666666666668 },
      { v: 2.3333333333333335, vel: 35.55555555555556 },
      { v: -3.6565333333333334, vel: -181.51111111111112 },
      { v: -3.9346128943758574, vel: -40.04345679012346 },
      { v: 17.81035720164609, vel: 434.89940192043895 },
      { v: 8.566885571248285, vel: -577.7169768998629 },
      { v: 10.016682528447737, vel: 72.48984785997254 },
    ]);
  });

  it("snaps value and target together and stops the velocity", () => {
    const c = new Chan(0.2, 9);
    c.t = 1; c.step(1 / 60); c.snap(0.7);
    expect({ v: c.v, t: c.t, vel: c.vel }).toEqual({ v: 0.7, t: 0.7, vel: 0 });
  });
});

describe("smooth", () => {
  const XS = [-0.5, 0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.9, 1, 1.5];

  it("is the prototype's smoothstep for e0 < e1", () => {
    expect(XS.map((x) => smooth(0.2, 0.9, x))).toEqual([0, 0, 0, 0, 0.1180758017492711, 0.39358600583090386, 0.7084548104956269, 1, 1, 1]);
    expect(XS.map((x) => smooth(0.0, 0.06, x))).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("keeps the JS-only inversion for e0 > e1 (smooth(0.9, 0.2, x) falls from 1 to 0); it is never fixed", () => {
    expect(XS.map((x) => smooth(0.9, 0.2, x))).toEqual([1, 1, 1, 1, 0.881924198250729, 0.6064139941690964, 0.2915451895043732, 0, 0, 0]);
    for (const x of XS) expect(smooth(0.9, 0.2, x)).toBeCloseTo(1 - smooth(0.2, 0.9, x), 12);
  });
});

describe("the small helpers", () => {
  it("clamp defaults to [0, 1] and passes NaN through", () => {
    expect([clamp(-0.5), clamp(0.25), clamp(1.5), clamp(5, 0, 3), clamp(-5, -2, 3)]).toEqual([0, 0.25, 1, 3, -2]);
    expect(Number.isNaN(clamp(NaN))).toBe(true);
  });

  it("lerp extrapolates past t = 1", () => {
    expect([lerp(0.2, 1.7, 0.3), lerp(1, 0.2, 0.75), lerp(-3, 5, 1.25)]).toEqual([0.6499999999999999, 0.3999999999999999, 7]);
  });

  it("gauss is exp(-((x - m) / s)^2)", () => {
    expect([gauss(0.6, 0.6, 0.13), gauss(0.5, 0.6, 0.13), gauss(1.43, 1.43, 0.1), gauss(2, Math.PI / 2, 0.22)])
      .toEqual([1, 0.5533768878965244, 1, 0.022234471424372952]);
  });

  it("angDist wraps to the shortest angle", () => {
    expect([angDist(0.1, -0.1), angDist(3.1, -3.1), angDist(2.51, -1.75), angDist(7, 0), angDist(-10, 1)])
      .toEqual([0.1999999999999993, 0.08318530717958694, 2.0231853071795864, 0.7168146928204138, 1.5663706143591725]);
  });

  it("the easings match the prototype", () => {
    const xs = [0, 0.25, 0.5, 0.8, 1];
    expect(xs.map(easeOutCubic)).toEqual([0, 0.578125, 0.875, 0.992, 1]);
    expect(xs.map(easeInQuad)).toEqual([0, 0.0625, 0.25, 0.6400000000000001, 1]);
    expect(xs.map(easeInOut)).toEqual([0, 0.15625, 0.5, 0.8960000000000001, 1]);
  });
});
