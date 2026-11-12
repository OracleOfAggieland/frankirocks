import { describe, expect, it } from "vitest";
import { SPRING } from "../motion";
import {
  PRESS_BODY,
  REST_DROP,
  REST_MS,
  RING_FROM,
  type SpiderInput,
  type SpiderState,
  TEXT_OFFSET,
  TEXT_OPACITY,
  initialSpider,
  spiderPose,
  stepSpider,
} from "./spider";
import { at, stepSpring } from "./spring";
import { MAX_WEBS, WEB_RINGS, WEB_SPOKE, WEB_SPOKES, webShape } from "./web";

const base: Omit<SpiderInput, "t"> = { x: 200, y: 150, present: true, touch: false, text: false, pressed: false };

/** Holds `input` for `ms` of 16 ms frames, starting after the state's last frame. */
function hold(s: SpiderState, ms: number, input: Partial<SpiderInput> = {}): SpiderState {
  let t = s.t ?? 0;
  const end = t + ms;
  let out = s;
  while (t < end) {
    t += 16;
    out = stepSpider(out, { ...base, ...input, t });
  }
  return out;
}

describe("Lab spider", () => {
  it("the head centre sits exactly on the pointer, with no lag", () => {
    let s = hold(initialSpider, 100);
    for (const [x, y] of [
      [210, 150],
      [260, 190],
      [262.5, 191.25],
    ]) {
      s = stepSpider(s, { ...base, x, y, t: (s.t ?? 0) + 16 });
      const p = spiderPose(s);
      expect(p.x).toBe(x);
      expect(p.y).toBe(y);
    }
  });

  it("fades in when present and out when the pointer leaves the window", () => {
    const shown = hold(initialSpider, 600);
    expect(spiderPose(shown).opacity).toBeGreaterThan(0.99);
    const gone = hold(shown, 800, { present: false });
    expect(spiderPose(gone).opacity).toBeLessThan(0.01);
  });

  it("over something you can touch, a ring grows from 60% and the front legs lift", () => {
    const s0 = hold(initialSpider, 300);
    expect(spiderPose(s0).ringOpacity).toBe(0);
    expect(spiderPose(s0).ringScale).toBeCloseTo(RING_FROM, 6);
    const s1 = hold(s0, 16, { touch: true });
    expect(spiderPose(s1).ringScale).toBeGreaterThan(RING_FROM);
    expect(spiderPose(s1).ringScale).toBeLessThan(0.75);
    const s2 = hold(s1, 600, { touch: true });
    expect(spiderPose(s2).ringScale).toBeCloseTo(1, 2);
    expect(spiderPose(s2).ringOpacity).toBeCloseTo(1, 2);
    expect(s2.lift.x).toBeCloseTo(1, 2);
  });

  it("over a text field it steps 14 px down and right, tucks its legs and drops to 70%", () => {
    const s0 = hold(initialSpider, 300);
    const reachBefore = Math.max(...spiderPose(s0).legs.map((l) => Math.hypot(l.foot.x - l.hip.x, l.foot.y - l.hip.y)));
    const s = hold(s0, 900, { text: true, touch: true });
    const p = spiderPose(s);
    expect(p.x).toBeCloseTo(base.x + TEXT_OFFSET, 1);
    expect(p.y).toBeCloseTo(base.y + TEXT_OFFSET, 1);
    expect(p.opacity).toBeCloseTo(TEXT_OPACITY, 2);
    expect(p.ringOpacity).toBeLessThan(0.01);
    const reachAfter = Math.max(...p.legs.map((l) => Math.hypot(l.foot.x - l.hip.x, l.foot.y - l.hip.y)));
    expect(reachAfter).toBeLessThan(reachBefore * 0.6);
  });

  it("on press the legs pull in and the body shrinks to 92%", () => {
    const s0 = hold(initialSpider, 300);
    const s = hold(s0, 400, { pressed: true });
    expect(spiderPose(s).bodyScale).toBeCloseTo(PRESS_BODY, 2);
    const reach = (st: SpiderState) => spiderPose(st).legs.reduce((sum, l) => sum + Math.hypot(l.foot.x - l.hip.x, l.foot.y - l.hip.y), 0);
    expect(reach(s)).toBeLessThan(reach(s0) * 0.8);
  });

  it("after 2000 ms still it lowers 10 px on a thread and sways; a move climbs it back", () => {
    const s0 = hold(initialSpider, REST_MS - 100);
    expect(spiderPose(s0).threadOpacity).toBe(0);
    const s1 = hold(s0, 2500);
    const p = spiderPose(s1);
    expect(p.y - base.y).toBeCloseTo(REST_DROP, 0);
    expect(p.threadOpacity).toBeGreaterThan(0.95);
    const sways = [0, 1, 2, 3, 4, 5, 6].map((k) => spiderPose(hold(s1, k * 700)).sway);
    expect(Math.max(...sways.map(Math.abs))).toBeGreaterThan(1);
    expect(Math.max(...sways.map(Math.abs))).toBeLessThanOrEqual(4.2);
    const moved = hold(s1, 1500, { x: base.x + 1 });
    expect(spiderPose(moved).y - base.y).toBeLessThan(0.5);
  });

  it("a press also climbs it back", () => {
    const resting = hold(initialSpider, REST_MS + 2000);
    expect(spiderPose(resting).y - base.y).toBeGreaterThan(9);
    const pressed = hold(resting, 1500, { pressed: true });
    expect(Math.abs(spiderPose(pressed).y - base.y)).toBeLessThan(0.5);
  });
});

describe("spider springs", () => {
  it("each motion spring settles on its target", () => {
    for (const spring of [SPRING.float, SPRING.settle, SPRING.press]) {
      let s = at(0);
      for (let i = 0; i < 200; i++) s = stepSpring(s, 1, spring, 16);
      expect(s.x).toBeCloseTo(1, 3);
    }
  });

  it("does nothing over no time", () => {
    expect(stepSpring({ x: 0.3, v: 2 }, 1, SPRING.settle, 0)).toEqual({ x: 0.3, v: 2 });
  });
});

describe("spider webs", () => {
  const coords = (d: string) => (d.match(/-?\d+\.\d+/g) ?? []).map(Number);

  it("six spokes of 11 px and two rings, the same for the same seed", () => {
    const w = webShape(7);
    expect(w).toEqual(webShape(7));
    expect(w).not.toEqual(webShape(8));
    expect(w.spokes.split("M").filter(Boolean)).toHaveLength(WEB_SPOKES);
    const tips = coords(w.spokes);
    for (let i = 0; i < tips.length; i += 4) expect(Math.hypot(tips[i + 2], tips[i + 3])).toBeCloseTo(WEB_SPOKE, 1);
    expect(w.rings.split("Z").filter(Boolean)).toHaveLength(WEB_RINGS.length);
    for (const v of coords(w.rings)) expect(Math.abs(v)).toBeLessThanOrEqual(Math.max(...WEB_RINGS) + 0.01);
    expect(MAX_WEBS).toBe(3);
  });
});
