import { describe, expect, it } from "vitest";
import { CANONICAL, FACE_POINT_COUNT, FIT_POINTS, LANDMARK } from "../../../components/xray/anatomy/canonical";
import { faceCorrection, projectHead } from "../../../components/xray/anatomy/fit";
import { SCRIPTED_ASPECT, createScriptedFeed, handJoints, scriptedFrame } from "./scripted-frames";

const TIMES = Array.from({ length: 120 }, (_, i) => i * 137);

describe("the scripted tracker", () => {
  it("gives one face of 478 landmarks and two hands of 21 joints, all finite and on the picture", () => {
    for (const t of TIMES) {
      const f = scriptedFrame(t);
      expect(f.at).toBe(t);
      expect(f.aspect).toBe(SCRIPTED_ASPECT);
      expect(f.face).not.toBeNull();
      expect(f.face!.points).toHaveLength(FACE_POINT_COUNT);
      expect(f.face!.matrix).toHaveLength(16);
      expect(f.face!.jaw).toBeGreaterThanOrEqual(0);
      expect(f.face!.jaw).toBeLessThanOrEqual(1);
      expect(f.hands.map((h) => h.side)).toEqual(["right", "left"]);
      for (const p of [...f.face!.points, ...f.hands.flatMap((h) => h.points)]) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(1);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(1);
      }
      for (const h of f.hands) expect(h.points).toHaveLength(21);
    }
  });

  it("agrees with itself: its matrix projects the canonical key points onto its own landmarks", () => {
    for (const t of TIMES) {
      const face = scriptedFrame(t).face!;
      for (const name of FIT_POINTS) {
        const p = projectHead(face.matrix, SCRIPTED_ASPECT, CANONICAL[name])!;
        const q = face.points[LANDMARK[name]]!;
        expect(Math.abs(p.x - q.x)).toBeLessThan(1e-9);
        expect(Math.abs(p.y - q.y)).toBeLessThan(1e-9);
      }
      const c = faceCorrection(face, SCRIPTED_ASPECT);
      expect(Math.abs(c.s - 1)).toBeLessThan(1e-9);
      expect(Math.abs(c.tx)).toBeLessThan(1e-9);
      expect(Math.abs(c.ty)).toBeLessThan(1e-9);
    }
  });

  it("puts the person's right on the unmirrored picture's left, and their nose in front of their face", () => {
    const f = scriptedFrame(0);
    const pts = f.face!.points;
    expect(pts[LANDMARK.rightEyeOuter]!.x).toBeLessThan(pts[LANDMARK.leftEyeOuter]!.x);
    expect(pts[LANDMARK.noseTip]!.z).toBeLessThan(pts[LANDMARK.rightSide]!.z);
    expect(pts[LANDMARK.forehead]!.y).toBeLessThan(pts[LANDMARK.chin]!.y);
    const right = f.hands.find((h) => h.side === "right")!;
    const left = f.hands.find((h) => h.side === "left")!;
    expect(right.points[0]!.x).toBeLessThan(pts[LANDMARK.noseTip]!.x);
    expect(left.points[0]!.x).toBeGreaterThan(pts[LANDMARK.noseTip]!.x);
  });

  it("talks: the jaw opens and shuts over a few seconds", () => {
    const jaws = TIMES.map((t) => scriptedFrame(t).face!.jaw);
    expect(Math.max(...jaws)).toBeGreaterThan(0.5);
    expect(Math.min(...jaws)).toBe(0);
  });

  it("closes the hand: a fist brings the fingertips back toward the wrist", () => {
    const open = handJoints(0);
    const fist = handJoints(1);
    for (const tip of [8, 12, 16, 20]) expect(Math.hypot(fist[tip]!.x, fist[tip]!.y, fist[tip]!.z)).toBeLessThan(Math.hypot(open[tip]!.x, open[tip]!.y, open[tip]!.z) * 0.75);
  });

  it("feeds the frame at the clock's time, and never touches the element it is given", () => {
    let now = 500;
    const feed = createScriptedFeed(() => now);
    expect(feed.latest()!.at).toBe(500);
    now = 900;
    expect(feed.latest()!.at).toBe(900);
    const detach = feed.attach({} as HTMLVideoElement);
    expect(typeof detach).toBe("function");
    detach();
  });
});
