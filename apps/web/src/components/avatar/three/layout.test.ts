// WP10: where the 3D ghost lands in its canvas (design note §4.3 item 3, §8.1). ghostBounds is pure three.js math
// over the ported surface; no renderer and no WebGL. The SVG side is read from SvgGhost's own path strings, so the
// check follows the drawing if it changes.
import { describe, expect, it } from "vitest";
import { CANVAS_FRAME } from "../canvas-frame";
import { BODY, HAIR } from "../SvgGhost";
import { ghostBounds } from "./layout";

/** The SVG's viewBox (SvgGhost: 0 0 200 220); the avatar box is 1 wide and 1.1 tall in box-width units. */
const VIEW_W = 200;
const BOX_H = 1.1;

/** Bounds of an absolute M/C/Z path, sampled along each cubic. The ghost's paths use only those commands. */
function pathBounds(d: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const tokens = d.match(/[MCZ]|-?\d*\.?\d+/g) ?? [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const take = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  let cmd = "";
  let cx = 0, cy = 0;
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i];
    if (t === "M" || t === "C" || t === "Z") { cmd = t; i++; if (t === "Z") continue; }
    if (cmd === "M") {
      cx = Number(tokens[i]); cy = Number(tokens[i + 1]); i += 2; take(cx, cy);
      cmd = "C";
    } else if (cmd === "C") {
      const [x1, y1, x2, y2, x3, y3] = tokens.slice(i, i + 6).map(Number);
      for (let s = 0; s <= 64; s++) {
        const u = s / 64, v = 1 - u;
        take(
          v * v * v * cx + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3,
          v * v * v * cy + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3,
        );
      }
      cx = x3; cy = y3; i += 6;
    } else {
      throw new Error(`unexpected token ${t} in ${d.slice(0, 40)}`);
    }
  }
  return { minX, maxX, minY, maxY };
}

describe("ghostBounds", () => {
  const wide = ghostBounds(1280 / 900);
  const square = ghostBounds(1);
  const tall = ghostBounds(0.6);

  it("lands the whole rest silhouette inside the canvas, hair above hem and nub left of nub", () => {
    for (const b of [wide, square, tall]) {
      expect(b.top).toBeGreaterThan(0);
      expect(b.bottom).toBeLessThan(1);
      expect(b.left).toBeGreaterThan(0);
      expect(b.right).toBeLessThan(1);
      expect(b.top).toBeLessThan(b.bottom);
      expect(b.left).toBeLessThan(b.right);
    }
  });

  it("keeps the vertical framing at every landscape aspect: resize() holds the camera at CAM_BASE.z there", () => {
    expect(square.top).toBeCloseTo(wide.top, 9);
    expect(square.bottom).toBeCloseTo(wide.bottom, 9);
    expect(square.right - square.left).toBeCloseTo((wide.right - wide.left) * (1280 / 900), 6);
  });

  it("pulls back on a portrait canvas (the portrait fit, 3425-3426), so the ghost takes less of the height", () => {
    expect(tall.bottom - tall.top).toBeLessThan(square.bottom - square.top);
  });

  it("matches the prototype camera's framing of the square canvas", () => {
    // Regression values for the estimate (fov 30, CAM_BASE, CAM_LOOK, HOVER, TURN, the profile and the mop).
    expect(square.top).toBeCloseTo(0.191, 3);
    expect(square.bottom).toBeCloseTo(0.841, 3);
    expect(square.left).toBeCloseTo(0.213, 3);
    expect(square.right).toBeCloseTo(0.723, 3);
  });
});

describe("CANVAS_FRAME", () => {
  it("puts the projected 3D silhouette on the SVG ghost's silhouette, each edge within 4% of the box height", () => {
    const body = pathBounds(BODY);
    const hair = pathBounds(HAIR);
    const svg = {
      top: Math.min(body.minY, hair.minY) / VIEW_W,
      bottom: Math.max(body.maxY, hair.maxY) / VIEW_W,
      left: Math.min(body.minX, hair.minX) / VIEW_W,
      right: Math.max(body.maxX, hair.maxX) / VIEW_W,
    };
    const f = CANVAS_FRAME;
    const g = ghostBounds(f.width / f.height);
    const three = {
      top: f.top + g.top * f.height,
      bottom: f.top + g.bottom * f.height,
      left: f.left + g.left * f.width,
      right: f.left + g.right * f.width,
    };
    const tol = 0.04 * BOX_H;
    expect(Math.abs(three.top - svg.top)).toBeLessThanOrEqual(tol);
    expect(Math.abs(three.bottom - svg.bottom)).toBeLessThanOrEqual(tol);
    expect(Math.abs(three.left - svg.left)).toBeLessThanOrEqual(tol);
    expect(Math.abs(three.right - svg.right)).toBeLessThanOrEqual(tol);
  });
});
