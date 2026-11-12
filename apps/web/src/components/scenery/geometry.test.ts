import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEPTH,
  STILL,
  catenaryPoints,
  catenaryY,
  coverScale,
  hangY,
  parallaxUnit,
  placeOnBox,
  placePoint,
  polyline,
  sceneToScreen,
  screenToScene,
  sliceCrop,
  solveCatenary,
  webPaths,
} from "./geometry";
import {
  CABLES,
  COIL_LEFT,
  COIL_TOP,
  DISCS,
  DISC_RY,
  LADDER_TOP,
  MAINS,
  MAINS_AT,
  SHELF_TOP,
  SLAB,
  SLAB_MAX_SHARE,
  SLAB_PER_FLOOR,
  TOP_BAND_PX,
  WEB_SPEC,
  mainsLabel,
} from "./scene";

const coord = fc.double({ min: -2000, max: 2000, noNaN: true });

describe("catenary", () => {
  it("passes through both hanging points and sags below the straight line between them", () => {
    fc.assert(
      fc.property(
        coord,
        fc.double({ min: 0, max: 400, noNaN: true }),
        fc.double({ min: 40, max: 1200, noNaN: true }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: 150, max: 900, noNaN: true }),
        (x0, y0, span, dy, a) => {
          const p0 = { x: x0, y: y0 };
          const p1 = { x: x0 + span, y: y0 + dy };
          const c = solveCatenary(p0, p1, a);
          expect(Math.abs(catenaryY(c, p0.x) - p0.y)).toBeLessThan(0.01);
          expect(Math.abs(catenaryY(c, p1.x) - p1.y)).toBeLessThan(0.01);
          for (const p of catenaryPoints(p0, p1, a, 12)) {
            const chord = p0.y + ((p.x - p0.x) / span) * dy;
            expect(p.y).toBeGreaterThanOrEqual(chord - 1e-6);
          }
        },
      ),
    );
  });

  it("is the same cable for the same input", () => {
    const p0 = { x: 90, y: 118 };
    const p1 = { x: 540, y: 104 };
    expect(polyline(catenaryPoints(p0, p1, 380, 12))).toBe(polyline(catenaryPoints(p0, p1, 380, 12)));
  });

  it("gives one M and one L per sample point", () => {
    const d = polyline(catenaryPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 200, 12));
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.match(/L/g)).toHaveLength(12);
  });
});

describe("web", () => {
  const spec = WEB_SPEC;

  it("has five threads and four rings of four scallops each", () => {
    const { threads, rings } = webPaths(spec);
    expect(threads.match(/M/g)).toHaveLength(5);
    expect(rings.match(/M/g)).toHaveLength(4);
    expect(rings.match(/Q/g)).toHaveLength(16);
  });

  it("dips each scallop toward the hub", () => {
    const { rings } = webPaths(spec);
    const nums = rings.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // Each ring: M x y, then four Q cx cy x y. A control point is nearer the hub than its end points.
    for (let ring = 0; ring < 4; ring++) {
      const base = ring * 18;
      for (let q = 0; q < 4; q++) {
        const o = base + 2 + q * 4;
        const dist = (x: number, y: number) => Math.hypot(x - 1440, y);
        const c = dist(nums[o], nums[o + 1]);
        const end = dist(nums[o + 2], nums[o + 3]);
        expect(c).toBeLessThan(end);
      }
    }
  });

  it("stays inside the drawing's top right quarter", () => {
    const { threads, rings } = webPaths(spec);
    const nums = `${threads} ${rings}`.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeLessThanOrEqual(1440);
      expect(nums[i + 1]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("parallax", () => {
  it("moves each depth at most its own number of screen pixels, against the pointer", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 4000, noNaN: true }),
        fc.double({ min: -500, max: 3000, noNaN: true }),
        fc.double({ min: 200, max: 4000, noNaN: true }),
        fc.double({ min: 200, max: 3000, noNaN: true }),
        (cx, cy, w, h) => {
          const u = parallaxUnit(cx, cy, w, h);
          const s = coverScale(w, h);
          for (const d of [DEPTH.far, DEPTH.near]) {
            expect(Math.abs(u.x * d * s)).toBeLessThanOrEqual(d + 1e-9);
            expect(Math.abs(u.y * d * s)).toBeLessThanOrEqual(d + 1e-9);
          }
          if (cx > w / 2) expect(u.x).toBeLessThanOrEqual(0);
          if (cy > h / 2) expect(u.y).toBeLessThanOrEqual(0);
        },
      ),
    );
  });

  it("rests at the centre of the viewport and on bad input", () => {
    expect(parallaxUnit(720, 450, 1440, 900)).toEqual({ x: 0, y: 0 });
    expect(parallaxUnit(10, 10, 0, 900)).toEqual({ x: 0, y: 0 });
    expect(parallaxUnit(Number.NaN, 10, 1440, 900)).toEqual({ x: 0, y: 0 });
  });

  it("reaches the full depth at a corner of a 1440 by 900 screen", () => {
    const u = parallaxUnit(1440, 0, 1440, 900);
    expect(u.x * DEPTH.near).toBeCloseTo(-6);
    expect(u.y * DEPTH.near).toBeCloseTo(6);
  });

  it("covers the viewport the way xMidYMax slice does", () => {
    expect(coverScale(1440, 900)).toBe(1);
    expect(coverScale(1920, 1080)).toBeCloseTo(4 / 3);
    expect(coverScale(375, 812)).toBeCloseTo(812 / 900);
  });
});

const size = fc.record({ w: fc.double({ min: 200, max: 5000, noNaN: true }), h: fc.double({ min: 200, max: 3000, noNaN: true }) });
/** Ordinary desktop windows (inside the browser's chrome), a tablet and a phone. */
const WINDOWS = [
  [1920, 945],
  [1366, 650],
  [1536, 730],
  [1440, 780],
  [2560, 1300],
  [1440, 900],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;
const DESKTOPS = WINDOWS.slice(0, 7);
const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);
const pairs = (d: string) => {
  const n = numbers(d);
  return Array.from({ length: n.length / 2 }, (_, i) => ({ x: n[i * 2], y: n[i * 2 + 1] }));
};

describe("slice crop", () => {
  it("shifts a point at the drawing's top corner onto the screen's top corner", () => {
    fc.assert(
      fc.property(size, ({ w, h }) => {
        const { top, side } = sliceCrop(w, h);
        expect(Math.min(top, side)).toBeLessThan(1e-6);
        const left = sceneToScreen({ x: side, y: top }, w, h);
        const right = sceneToScreen({ x: 1440 - side, y: top }, w, h);
        expect(left.x).toBeCloseTo(0, 6);
        expect(left.y).toBeCloseTo(0, 6);
        expect(right.x).toBeCloseTo(w, 6);
        expect(right.y).toBeCloseTo(0, 6);
      }),
    );
  });

  it("maps screen and drawing points back and forth", () => {
    fc.assert(
      fc.property(size, coord, coord, ({ w, h }, x, y) => {
        const back = screenToScene(sceneToScreen({ x, y }, w, h), w, h);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }),
    );
  });

  it("cuts nothing at 1440 by 900 and on bad input", () => {
    expect(sliceCrop(1440, 900)).toEqual({ top: 0, side: 0 });
    expect(sliceCrop(0, 900)).toEqual({ top: 0, side: 0 });
  });

  it("keeps every insulator, the web's hub and its first ring on screen", () => {
    for (const [w, h] of WINDOWS) {
      const { top, side } = sliceCrop(w, h);
      for (const c of CABLES) {
        for (const p of [c.from, c.to]) {
          // Only where the insulator is inside the drawing's visible width; on tall screens the sides go.
          if (p.x < side || p.x > 1440 - side) continue;
          const highest = sceneToScreen({ x: p.x, y: p.y + DISCS[0].dy - DISC_RY + top }, w, h);
          const lowest = sceneToScreen({ x: p.x, y: p.y + top }, w, h);
          expect(highest.y).toBeGreaterThanOrEqual(0);
          expect(lowest.y).toBeLessThanOrEqual(h);
        }
      }
      const hub = sceneToScreen({ x: WEB_SPEC.hub.x - side, y: WEB_SPEC.hub.y + top }, w, h);
      expect(hub.x).toBeCloseTo(w, 6);
      expect(hub.y).toBeCloseTo(0, 6);
      const ring = WEB_SPEC.radii[0] * coverScale(w, h);
      expect(ring).toBeLessThan(Math.min(w, h));
    }
    // On every desktop window both cables are wholly on screen.
    for (const [w, h] of DESKTOPS) {
      const { top } = sliceCrop(w, h);
      for (const c of CABLES) {
        for (const p of catenaryPoints(c.from, c.to, c.a, c.segments)) {
          const s = sceneToScreen({ x: p.x, y: p.y + top }, w, h);
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x).toBeLessThanOrEqual(w);
          expect(s.y).toBeGreaterThan(0);
        }
      }
    }
  });

  it("hangs the shifted cables and web clear of the shelf, the ladder and the coil on desktop windows", () => {
    const low = (c: (typeof CABLES)[number]) => Math.max(...catenaryPoints(c.from, c.to, c.a, 48).map((p) => p.y));
    const web = webPaths(WEB_SPEC);
    const webPts = pairs(`${web.threads} ${web.rings}`);
    for (const [w, h] of DESKTOPS) {
      const { top } = sliceCrop(w, h);
      expect(low(CABLES[0]) + top).toBeLessThan(SHELF_TOP - 8);
      expect(low(CABLES[1]) + top).toBeLessThan(LADDER_TOP - 8);
      for (const p of webPts) if (p.x < COIL_LEFT + 100) expect(p.y + top).toBeLessThan(COIL_TOP);
    }
  });
});

describe("mains label", () => {
  /** The label's words are 12 screen px; count the whole em above the baseline, plus the far depth's drift. */
  const LABEL_PX = 12;
  const windows = () => {
    const out: [number, number][] = [];
    for (let w = 320; w <= 1920; w += 40) for (let h = 500; h <= 1200; h += 25) out.push([w, h]);
    return out;
  };

  it("lands hangY points that many screen px below the top, through the top crop", () => {
    fc.assert(
      fc.property(size, fc.double({ min: 0, max: 400, noNaN: true }), ({ w, h }, px) => {
        const { top } = sliceCrop(w, h);
        expect(sceneToScreen({ x: 720, y: hangY(px, w, h) + top }, w, h).y).toBeCloseTo(px, 6);
      }),
    );
  });

  it("never draws its words in the top band, from 320 to 1920 px wide and 500 to 1200 px tall", () => {
    for (const [w, h] of windows()) {
      const { top } = sliceCrop(w, h);
      const m = mainsLabel(w, h);
      const baseline = sceneToScreen({ x: m.textX, y: m.textY + top }, w, h).y;
      expect(baseline - LABEL_PX - DEPTH.far).toBeGreaterThanOrEqual(TOP_BAND_PX);
      // And it stays near the band, so it still reads as hanging off the cable.
      expect(baseline).toBeLessThan(TOP_BAND_PX + 40);
    }
  });

  it("drops its leader from the dot on the cable down to beside the words", () => {
    expect(MAINS_AT.y).toBeCloseTo(catenaryY(solveCatenary(CABLES[0].from, CABLES[0].to, CABLES[0].a), MAINS.x), 1);
    expect(MAINS.x).toBeGreaterThan(CABLES[0].from.x);
    expect(MAINS.x).toBeLessThan(CABLES[0].to.x - DISCS[2].rx);
    for (const [w, h] of windows()) {
      const m = mainsLabel(w, h);
      const [, y0, y1] = numbers(m.leader);
      expect(numbers(m.leader)[0]).toBe(MAINS_AT.x);
      expect(y0).toBeCloseTo(MAINS_AT.y + 2, 1);
      expect(y1).toBeGreaterThan(y0);
      expect(y1).toBeLessThan(m.textY);
      // The words hang over the shelf's end of the room: they must stay well above the shelf itself.
      expect(m.textY).toBeLessThan(SHELF_TOP - 40);
    }
  });

  it("is drawn for a 1440 by 900 window before the first layout pass", () => {
    expect(mainsLabel(1440, 900).textY).toBe(MAINS.baselinePx);
  });
});

describe("slab placement", () => {
  const thing = { centre: { x: SLAB.cx, y: SLAB.cy }, width: SLAB.rx * 2 };
  const box = fc.record({
    left: fc.double({ min: -200, max: 3000, noNaN: true }),
    top: fc.double({ min: -200, max: 2000, noNaN: true }),
    width: fc.double({ min: 60, max: 400, noNaN: true }),
    height: fc.double({ min: 4, max: 40, noNaN: true }),
  });

  it("puts the slab's centre on the floor shadow's centre, never wider than the screen allows", () => {
    fc.assert(
      fc.property(size, box, ({ w, h }, b) => {
        const p = placeOnBox(b, w, h, thing, SLAB_PER_FLOOR, SLAB_MAX_SHARE);
        const c = sceneToScreen(placePoint(p, thing.centre, thing.centre), w, h);
        expect(c.x).toBeCloseTo(b.left + b.width / 2, 6);
        expect(c.y).toBeCloseTo(b.top + b.height / 2, 6);
        expect(p.k).toBeGreaterThanOrEqual(0.5);
        expect(p.k).toBeLessThanOrEqual(1.3);
        const px = thing.width * p.k * coverScale(w, h);
        const wanted = Math.min(SLAB_PER_FLOOR * b.width, SLAB_MAX_SHARE * w);
        if (p.k > 0.5 && p.k < 1.3) expect(px).toBeCloseTo(wanted, 6);
        else if (p.k === 1.3) expect(px).toBeLessThanOrEqual(wanted + 1e-6);
      }),
    );
  });

  it("fits the slab on a phone", () => {
    // A 276 px stage on a 375 by 812 phone: its floor shadow is three fifths as wide.
    const b = { left: (375 - 165.6) / 2, top: 520, width: 165.6, height: 13.8 };
    const p = placeOnBox(b, 375, 812, thing, SLAB_PER_FLOOR, SLAB_MAX_SHARE);
    const l = sceneToScreen(placePoint(p, thing.centre, { x: SLAB.cx - SLAB.rx, y: SLAB.cy }), 375, 812);
    const r = sceneToScreen(placePoint(p, thing.centre, { x: SLAB.cx + SLAB.rx, y: SLAB.cy }), 375, 812);
    expect(l.x).toBeGreaterThan(0);
    expect(r.x).toBeLessThan(375);
  });

  it("stays put on bad input", () => {
    expect(placeOnBox({ left: 0, top: 0, width: 0, height: 0 }, 1440, 900, thing, 2, 0.9)).toEqual(STILL);
    expect(placeOnBox({ left: Number.NaN, top: 0, width: 100, height: 10 }, 1440, 900, thing, 2, 0.9)).toEqual(STILL);
  });
});
