// WP9: the render-density scale of edit E10 (design note §1.3, §4.3 item 3) and the ladder around it, with fakes for
// the renderer, passes and meshes. No three.js and no WebGL: quality.ts imports only types, math and canvas-frame.
import { afterEach, describe, expect, it, vi } from "vitest";
import { REF_FRAME_H } from "../canvas-frame";
import { createQuality, renderScaleFor } from "./quality";

describe("renderScaleFor", () => {
  it("is 1 at the reference height on a DPR 1 display", () => {
    expect(REF_FRAME_H).toBe(900);
    expect(renderScaleFor(900, 1)).toBe(1);
  });

  it("is 1 at the reference height on a DPR 2 display (never renders sparser than CSS pixels x the tier)", () => {
    expect(renderScaleFor(900, 2)).toBe(1);
  });

  it("is 900 / 384 for a 384 px canvas on a DPR 1 display", () => {
    expect(renderScaleFor(384, 1)).toBeCloseTo(900 / 384, 12);
  });

  it("never goes below 1 or above 3", () => {
    for (const h of [1, 10, 100, 144, 240, 300, 384, 600, 900, 1200, 2160, 5000]) {
      for (const dpr of [0.85, 1, 1.25, 1.5, 1.75, 2, 3]) {
        const s = renderScaleFor(h, dpr);
        expect(s).toBeGreaterThanOrEqual(1);
        expect(s).toBeLessThanOrEqual(3);
      }
    }
    expect(renderScaleFor(100, 1)).toBe(3);
  });
});

type QualityRc = Parameters<typeof createQuality>[0];

function fakes(w: number, h: number, visible = true) {
  const calls: { pr: number[]; size: [number, number, boolean][]; res: [number, number][]; draw: [number, number][] } = { pr: [], size: [], res: [], draw: [] };
  const mapSize = { x: 2048, set(a: number) { mapSize.x = a; } };
  const rc = {
    host: { visibility: { isVisible: () => visible, subscribe: () => () => {} } },
    size: { w, h },
    STILL: false,
    URLP: { quality: "auto" },
    renderer: {
      setPixelRatio: (p: number) => calls.pr.push(p),
      setSize: (a: number, b: number, c: boolean) => calls.size.push([a, b, c]),
      shadowMap: { needsUpdate: false },
    },
    keyLight: { shadow: { mapSize, map: null } },
    bloomPass: { enabled: true },
    gradePass: { uniforms: { uRes: { value: { set: (a: number, b: number) => calls.res.push([a, b]) } } } },
    U: { uNoiseAmt: { value: 0 } },
    furGeo: { instanceCount: 0 },
    furMat: { uniforms: { uFurN: { value: 0 } } },
    fur: { visible: false },
    MOTES: 1000,
    moteGeo: { setDrawRange: (a: number, b: number) => calls.draw.push([a, b]) },
    moteMat: { uniforms: { uPR: { value: 0 } } },
  };
  return { rc, calls };
}

describe("createQuality", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the prototype's ladder, deduplicated against the display ratio", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { rc } = fakes(384, 384);
    const q = createQuality(rc as unknown as QualityRc);
    q.buildLadder();
    expect(q.quality.ladder.map((e) => `${e.tier}@${e.dpr}`)).toEqual(["high@1", "medium@1", "low@1", "low@0.85"]);

    vi.stubGlobal("window", { devicePixelRatio: 2 });
    q.buildLadder();
    expect(q.quality.ladder.map((e) => `${e.tier}@${e.dpr}`)).toEqual(["high@2", "high@1.75", "high@1.5", "medium@1.5", "medium@1.25", "low@1", "low@0.85"]);
  });

  it("E10: a 384 px canvas on DPR 1 renders the top tier 900 device pixels tall", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { rc, calls } = fakes(384, 384);
    const q = createQuality(rc as unknown as QualityRc);
    q.buildLadder();
    q.setQualityMode("auto");
    const pr = 900 / 384;
    expect(q.quality.idx).toBe(0);
    expect(calls.pr.at(-1)).toBeCloseTo(pr, 12);
    expect(calls.size.at(-1)).toEqual([384, 384, false]);
    expect(rc.moteMat.uniforms.uPR.value).toBeCloseTo(pr, 12);
    const res = calls.res.at(-1)!;
    expect(res[0]).toBeCloseTo(900, 9);
    expect(res[1]).toBeCloseTo(900, 9);
  });

  it("E10: the prototype's 1280 x 900 parity frame on DPR 1 is unchanged (scale 1)", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { rc, calls } = fakes(1280, 900);
    const q = createQuality(rc as unknown as QualityRc);
    q.buildLadder();
    q.setQualityMode("auto");
    expect(calls.pr.at(-1)).toBe(1);
    expect(calls.res.at(-1)).toEqual([1280, 900]);
  });

  it("E10: lower tiers scale down from the same reference", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { rc, calls } = fakes(384, 384);
    const q = createQuality(rc as unknown as QualityRc);
    q.buildLadder();
    q.applyQuality(3);
    expect(q.quality.ladder[3].dpr).toBe(0.85);
    expect(calls.pr.at(-1)).toBeCloseTo(0.85 * (900 / 384), 12);
    expect(rc.bloomPass.enabled).toBe(false);
    expect(rc.fur.visible).toBe(false);
    expect(rc.keyLight.shadow.mapSize.x).toBe(1024);
  });

  it("never sizes the targets to zero", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { rc, calls } = fakes(0, 0);
    const q = createQuality(rc as unknown as QualityRc);
    q.buildLadder();
    q.setQualityMode("auto");
    expect(calls.pr).toEqual([]);
    expect(calls.size).toEqual([]);
  });

  it("E5: tickQuality learns nothing while the page is hidden", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const hidden = fakes(384, 384, false);
    const qh = createQuality(hidden.rc as unknown as QualityRc);
    qh.tickQuality(16.7, 1);
    expect(qh.quality.warm).toEqual([]);

    const shown = fakes(384, 384, true);
    const qs = createQuality(shown.rc as unknown as QualityRc);
    qs.tickQuality(16.7, 1);
    expect(qs.quality.warm).toEqual([16.7]);
  });
});
