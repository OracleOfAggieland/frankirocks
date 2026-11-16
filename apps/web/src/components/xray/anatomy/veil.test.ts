import { describe, expect, it } from "vitest";
import { scriptedFrame } from "../../../ui/xray/testing/scripted-frames";
import { FACE_OVAL } from "./canonical";
import { coverFit, pictureToScreen } from "./screen-map";
import { faceVeil, handVeil } from "./veil";

describe("the veil over the flesh", () => {
  const frame = scriptedFrame(1200);
  const fit = coverFit(frame.aspect, 900, 700, true);

  it("follows the face's outline through the bones' own mapping, and feathers out past it", () => {
    const v = faceVeil(frame.face!.points, fit)!;
    expect(v.inner).toHaveLength(FACE_OVAL.length);
    const first = frame.face!.points[FACE_OVAL[0]!]!;
    expect(v.inner[0]).toEqual(pictureToScreen(fit, first.x, first.y));
    v.inner.forEach((p, i) => {
      const o = v.outer[i]!;
      expect(Math.hypot(o.x - v.center.x, o.y - v.center.y)).toBeGreaterThan(Math.hypot(p.x - v.center.x, p.y - v.center.y));
    });
    // The crown reaches further than the chin.
    const reach = (i: number) => Math.hypot(v.outer[i]!.x - v.inner[i]!.x, v.outer[i]!.y - v.inner[i]!.y);
    expect(reach(0)).toBeGreaterThan(reach(FACE_OVAL.length / 2) * 2);
  });

  it("draws nothing for a face with landmarks missing", () => {
    expect(faceVeil(frame.face!.points.slice(0, 100), fit)).toBeNull();
    expect(handVeil(frame.hands[0]!.points.slice(0, 20), fit)).toEqual([]);
  });

  it("covers a hand with soft discs along its fingers", () => {
    const discs = handVeil(frame.hands[0]!.points, fit);
    expect(discs.length).toBeGreaterThan(21);
    for (const d of discs) expect(Number.isFinite(d.x) && Number.isFinite(d.y) && d.r > 0).toBe(true);
  });
});
