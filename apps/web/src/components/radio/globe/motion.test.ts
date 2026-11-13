import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DEG,
  FACE_ABOVE,
  INITIAL_GLOBE,
  IDLE_SPIN,
  MAX_SPIN,
  PITCH_LIMIT,
  REST_PITCH,
  type GlobeMotion,
  dragBy,
  faceStation,
  faceTarget,
  globeAtRest,
  latLonToVec,
  markerLook,
  normYaw,
  release,
  stepGlobe,
} from "./motion";

const LIVE = { idleSpin: false, still: false };
const run = (m: GlobeMotion, seconds: number, opts = LIVE) => {
  let next = m;
  for (let i = 0; i < Math.round(seconds * 60); i++) next = stepGlobe(next, 1 / 60, opts);
  return next;
};

describe("latLonToVec", () => {
  it("puts latitude 0, longitude 0 at +Z, north at +Y and east at +X", () => {
    const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, 12));
    close(latLonToVec(0, 0), [0, 0, 1]);
    close(latLonToVec(90, 0), [0, 1, 0]);
    close(latLonToVec(0, 90), [1, 0, 0]);
    close(latLonToVec(0, -90), [-1, 0, 0]);
    close(latLonToVec(0, 180), [0, 0, -1]);
    for (const [lat, lon] of [[48.86, 2.35], [-33.87, 151.21], [-23.55, -46.63]] as const) {
      expect(Math.hypot(...latLonToVec(lat, lon))).toBeCloseTo(1, 12);
    }
  });

  it("agrees with the engine's turn: a faced station ends at the front, a little above centre", () => {
    for (const [lat, lon] of [[48.86, 2.35], [-33.87, 151.21], [-23.55, -46.63], [64, 177], [-1.3, -170]] as const) {
      const t = faceTarget(lat, lon);
      const p = new THREE.Vector3(...latLonToVec(lat, lon)).applyEuler(new THREE.Euler(t.pitch, t.yaw, 0, "XYZ"));
      expect(p.x).toBeCloseTo(0, 9);
      expect(p.z).toBeGreaterThan(0.9);
      expect(p.y).toBeCloseTo(Math.sin(FACE_ABOVE), 9);
    }
  });
});

describe("normYaw", () => {
  it("lands every angle in [-pi, pi)", () => {
    for (const a of [0, Math.PI, -Math.PI, 3 * Math.PI, -7.5, 1e9, -1e9]) {
      const r = normYaw(a);
      expect(r).toBeGreaterThanOrEqual(-Math.PI);
      expect(r).toBeLessThan(Math.PI);
      expect(Math.cos(r)).toBeCloseTo(Math.cos(a), 6);
    }
    expect(normYaw(Number.NaN)).toBe(0);
  });
});

describe("dragging", () => {
  it("starts leaning north and turns right with a drag to the right", () => {
    expect(INITIAL_GLOBE.pitch).toBe(REST_PITCH);
    const m = dragBy(INITIAL_GLOBE, 100, 0, 400);
    expect(m.yaw).toBeGreaterThan(0);
    expect(m.held).toBe(true);
    expect(dragBy(INITIAL_GLOBE, 0, 1e6, 400).pitch).toBe(PITCH_LIMIT);
    expect(dragBy(INITIAL_GLOBE, 0, -1e6, 400).pitch).toBe(-PITCH_LIMIT);
  });

  it("coasts after a release and slows to a stop", () => {
    const let_go = release(dragBy(INITIAL_GLOBE, 10, 0, 400), 800, 0, 400, { still: false });
    expect(let_go.vYaw).toBeGreaterThan(0);
    expect(let_go.vYaw).toBeLessThanOrEqual(MAX_SPIN);
    const later = run(let_go, 4);
    expect(later.vYaw).toBe(0);
    expect(globeAtRest(later, false)).toBe(true);
  });

  it("holds still while held, and does not coast under still", () => {
    const held = dragBy(INITIAL_GLOBE, 10, 0, 400);
    expect(run(held, 1, { idleSpin: true, still: false })).toBe(held);
    expect(release(held, 800, 800, 400, { still: true }).vYaw).toBe(0);
  });
});

describe("idle spin", () => {
  it("turns slowly only when asked and nothing is held or easing", () => {
    const spun = run(INITIAL_GLOBE, 1, { idleSpin: true, still: false });
    expect(spun.yaw).toBeCloseTo(IDLE_SPIN, 3);
    expect(run(INITIAL_GLOBE, 1).yaw).toBe(0);
    expect(run(INITIAL_GLOBE, 1, { idleSpin: true, still: true })).toBe(INITIAL_GLOBE);
  });
});

describe("facing a station", () => {
  it("eases the shortest way round and lands exactly", () => {
    const from = { ...INITIAL_GLOBE, yaw: 170 * DEG };
    const m = faceStation(from, 0, 170, { still: false }); // target yaw -170 degrees: 20 degrees on, across the seam
    const first = stepGlobe(m, 1 / 60, LIVE);
    expect(first.yaw).toBeGreaterThan(from.yaw);
    const done = run(m, 3);
    expect(done.yaw).toBe(faceTarget(0, 170).yaw);
    expect(done.pitch).toBe(faceTarget(0, 170).pitch);
    expect(done.target).toBeNull();
  });

  it("jumps under still", () => {
    const m = faceStation(INITIAL_GLOBE, 48.86, 2.35, { still: true });
    expect(m.yaw).toBe(faceTarget(48.86, 2.35).yaw);
    expect(m.target).toBeNull();
  });

  it("is cancelled by a drag", () => {
    expect(dragBy(faceStation(INITIAL_GLOBE, 10, 10, { still: false }), 1, 1, 100).target).toBeNull();
  });

  it("never aims past the pitch clamp", () => {
    expect(faceTarget(90, 0).pitch).toBe(PITCH_LIMIT);
    expect(faceTarget(-90, 0).pitch).toBe(-PITCH_LIMIT);
  });
});

describe("markerLook", () => {
  it("sends rings out only while playing, fading as they spread", () => {
    const live = markerLook("playing", 0.3, false);
    expect(live.tone).toBe("live");
    expect(live.rings).toHaveLength(3);
    expect(live.rings.some((r) => r.opacity > 0)).toBe(true);
    const sorted = [...live.rings].sort((a, b) => a.radius - b.radius);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.opacity).toBeLessThanOrEqual(sorted[i - 1]!.opacity);
    for (const s of ["tuning", "noSignal", "tapToPlay", "silent"] as const) expect(markerLook(s, 0.3, false).rings.every((r) => r.opacity === 0)).toBe(true);
  });

  it("flickers while tuning, shows ember with no signal, and holds steady under still", () => {
    const levels = new Set([0.1, 0.2, 0.3, 0.4].map((t) => markerLook("tuning", t, false).level.toFixed(3)));
    expect(levels.size).toBeGreaterThan(2);
    expect(markerLook("noSignal", 1, false).tone).toBe("ember");
    expect(markerLook("tuning", 0.1, true)).toEqual(markerLook("tuning", 9, true));
    expect(markerLook("playing", 0.1, true)).toEqual(markerLook("playing", 9, true));
  });
});

describe("motion.ts", () => {
  it("imports no three.js, reads no clock and draws no random number", () => {
    const src = readFileSync(join(__dirname, "motion.ts"), "utf8");
    expect(src).not.toMatch(/from "three/);
    expect(src).not.toMatch(/Date|performance|Math\.random/);
  });
});
