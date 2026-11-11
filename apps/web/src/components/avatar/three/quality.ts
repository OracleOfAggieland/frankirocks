// Prototype franki.html 3111-3207 (section 12: the quality ladder) and `perf` (3343, moved here), ported in WP9.
// Allowed edits E1, E3, E5 (`innerWidth`/`innerHeight` → `size.w`/`size.h`; `document.hidden` at 3164 →
// `!host.visibility.isVisible()`), E6 (`$('qualNow')`, `$('qualSel')` removed), E7, and E10 in applyQuality:
// `const pr = e.dpr * renderScaleFor(size.h, L[0].dpr)`, then `renderer.setPixelRatio(pr)`, mote `uPR` = pr and
// grade `uRes` = size × pr. buildLadder keeps its `window.devicePixelRatio` read.
import { REF_FRAME_H } from "../canvas-frame";
import type { ConfigPart, QualityMode } from "./config";
import type { HostPart } from "./context";
import type { WorldFxPart } from "./fx-world";
import type { HairPart } from "./hair";
import { clamp } from "./math";
import type { StagePart } from "./stage";
import type { UniformsPart } from "./uniforms";

export type Tier = "high" | "medium" | "low";

export interface LadderEntry { tier: Tier; dpr: number; shadow: number; every: number; noise: number; bloom: boolean; motes: number; fur: number }

/** The ladder's state (3123-3124). */
export interface QualityState {
  mode: QualityMode;
  ladder: LadderEntry[];
  idx: number;
  ema: number; budget: number; warm: number[]; slowFor: number; stableFor: number;
  probeFrom: number; probeT: number; holdUntil: number;
  base: number; recent: Float32Array<ArrayBuffer>; ri: number; dropFrom: number; dropEma: number; dropT: number; capHits: number;
}

export interface Perf { ema: number; cpu: number }

export interface QualityPart {
  LADDER_BASE: LadderEntry[];
  quality: QualityState;
  perf: Perf;
  buildLadder(): void;
  applyQuality(idx: number): void;
  setQualityMode(mode: QualityMode): void;
  /** `dtMs` is the unclamped rawDt × 1000; `t` is host.mono() / 1000 (3395). */
  tickQuality(dtMs: number, t: number): void;
}

/**
 * contract (E10): how much denser than CSS pixels × the tier's ratio the engine renders, so the ladder's top tier
 * draws the frame REF_FRAME_H device pixels tall: clamp(REF_FRAME_H / (cssHeight × topDpr), 1, 3). Pure.
 */
export function renderScaleFor(cssHeight: number, topDpr: number): number {
  return clamp(REF_FRAME_H / (cssHeight * topDpr), 1, 3);
}

export function createQuality(rc: HostPart & ConfigPart & StagePart & UniformsPart & HairPart & WorldFxPart): QualityPart {
  const { host, size, STILL, URLP, renderer, keyLight, bloomPass, gradePass, U, furGeo, furMat, fur, MOTES, moteGeo, moteMat } = rc;

  const perf: Perf = { ema: 16.7, cpu: 0 };                                // 3343, moved here: tickQuality reads perf.cpu

  /* =====================================================================
     12. QUALITY: fixed tiers or an adaptive ladder (resolution first, then pass quality)
     ===================================================================== */
  const LADDER_BASE: LadderEntry[] = [
    { tier: 'high', dpr: 2.0, shadow: 2048, every: 1, noise: 1, bloom: true, motes: 1, fur: 5 },
    { tier: 'high', dpr: 1.75, shadow: 2048, every: 1, noise: 1, bloom: true, motes: 1, fur: 5 },
    { tier: 'high', dpr: 1.5, shadow: 2048, every: 1, noise: 1, bloom: true, motes: 1, fur: 5 },
    { tier: 'medium', dpr: 1.5, shadow: 2048, every: 2, noise: 1, bloom: true, motes: 1, fur: 3 },
    { tier: 'medium', dpr: 1.25, shadow: 2048, every: 2, noise: 1, bloom: true, motes: 0.8, fur: 3 },
    { tier: 'low', dpr: 1.0, shadow: 1024, every: 2, noise: 0, bloom: true, motes: 0.6, fur: 2 },
    { tier: 'low', dpr: 0.85, shadow: 1024, every: 3, noise: 0, bloom: false, motes: 0.5, fur: 0 },
  ];
  const quality: QualityState = { mode: STILL && URLP.quality === 'auto' ? 'high' : URLP.quality, ladder: [] as LadderEntry[], idx: 0, ema: 16.7, budget: 16.7, warm: [] as number[], slowFor: 0, stableFor: 0, probeFrom: -1, probeT: 0, holdUntil: 0,
    base: 16.7, recent: new Float32Array(45).fill(16.7), ri: 0, dropFrom: -1, dropEma: 0, dropT: 0, capHits: 0 };
  function buildLadder() {
    const dev = window.devicePixelRatio || 1, out = [] as LadderEntry[];
    for (const e of LADDER_BASE) {
      const d = e.dpr >= 1 ? Math.min(e.dpr, Math.max(1, dev)) : e.dpr;
      const last = out[out.length - 1];
      if (last && last.tier === e.tier && last.dpr === d) continue;
      out.push({ ...e, dpr: d });
    }
    quality.ladder = out;
  }
  function applyQuality(idx: number) {
    const L = quality.ladder;
    quality.idx = clamp(idx, 0, L.length - 1);
    const e = L[quality.idx];
    if (size.w < 1 || size.h < 1) return;                                   // never size the HDR targets to zero
    const pr = e.dpr * renderScaleFor(size.h, L[0].dpr);                    // contract (E10): the top tier draws REF_FRAME_H device pixels tall
    renderer.setPixelRatio(pr);
    renderer.setSize(size.w, size.h, false);
    moteMat.uniforms.uPR.value = pr;
    if (keyLight.shadow.mapSize.x !== e.shadow) {
      keyLight.shadow.mapSize.set(e.shadow, e.shadow);
      if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
      renderer.shadowMap.needsUpdate = true;
    }
    bloomPass.enabled = e.bloom;
    U.uNoiseAmt.value = e.noise ? 0.0025 : 0;
    moteGeo.setDrawRange(0, Math.round(MOTES * e.motes));
    furGeo.instanceCount = e.fur; furMat.uniforms.uFurN.value = Math.max(1, e.fur); fur.visible = e.fur > 0;                    // shells are spread evenly: fewer shells, same fur length
    gradePass.uniforms.uRes.value.set(size.w * pr, size.h * pr);
  }
  function setQualityMode(mode: QualityMode) {
    quality.mode = mode;
    const L = quality.ladder;
    if (mode === 'auto') applyQuality(Math.max(0, L.findIndex((e) => e.dpr <= 1.75)));
    else applyQuality(Math.max(0, L.findIndex((e) => e.tier === mode)));
    quality.slowFor = quality.stableFor = 0; quality.probeFrom = quality.dropFrom = -1;
  }
  function tickQuality(dtMs: number, t: number) {
    if (!host.visibility.isVisible() || dtMs <= 0 || dtMs > 250) return;
    if (quality.warm.length < 60) {                                           // learn the display's frame budget (vsync-capped)
      quality.warm.push(dtMs);
      if (quality.warm.length === 60) { const s = [...quality.warm].sort((a, b) => a - b); quality.budget = quality.base = Math.min(16.7, s[30]); quality.ema = quality.budget; }
      return;
    }
    if (quality.ema < quality.budget * 0.75) quality.budget = Math.max(quality.base, quality.budget - 0.02);   // the cap lifted: drift back to the display rate
    quality.ema += (dtMs - quality.ema) * 0.05;
    quality.recent[quality.ri++ % quality.recent.length] = dtMs;
    if (quality.mode !== 'auto') return;
    const sec = dtMs / 1000;
    if (quality.dropFrom >= 0 && t - quality.dropT > 2.5) {
      // A step that did not shorten the frame may mean the display or browser caps the rate (a 30 Hz pane, battery saver, a
      // throttled window) rather than the GPU. That is only believed when the median sits near a vsync multiple, the CPU frame is
      // far below it, and two drops in a row both failed: then the drop is undone and the capped cadence becomes the budget.
      // Otherwise the drop stays, so a GPU-bound device keeps sliding down the ladder toward 60 fps.
      if (quality.ema > quality.dropEma * 0.9) {
        const s = Array.from(quality.recent).sort((a, b) => a - b), med = s[s.length >> 1];
        const vs = quality.base > 0 ? med / quality.base : 0, nearVsync = vs > 1.5 && Math.abs(vs - Math.round(vs)) < 0.15;
        quality.capHits = nearVsync && perf.cpu < med * 0.5 ? quality.capHits + 1 : 0;
        if (quality.capHits >= 2) {
          quality.budget = Math.max(quality.budget, med);
          applyQuality(quality.dropFrom); quality.ema = quality.budget; quality.holdUntil = t + 10; quality.capHits = 0;
        }
      } else quality.capHits = 0;
      quality.dropFrom = -1;
    }
    const B = quality.budget;
    if (quality.probeFrom >= 0) {                                             // probing a better tier: keep it or revert
      if (t - quality.probeT > 2) {
        if (quality.ema > B * 1.1) { applyQuality(quality.probeFrom); quality.holdUntil = t + 20; }
        quality.probeFrom = -1; quality.stableFor = 0;
      }
      return;
    }
    if (quality.ema > B * 1.15) { quality.slowFor += sec; quality.stableFor = 0; } else { quality.slowFor = 0; quality.stableFor += sec; }
    if (quality.slowFor > 1.5 && quality.idx < quality.ladder.length - 1 && quality.dropFrom < 0) {
      quality.dropFrom = quality.idx; quality.dropEma = quality.ema; quality.dropT = t;
      applyQuality(quality.idx + 1); quality.slowFor = 0;
    }
    else if (quality.stableFor > 8 && quality.idx > 0 && t > quality.holdUntil) {
      quality.probeFrom = quality.idx; quality.probeT = t; applyQuality(quality.idx - 1); quality.stableFor = 0; quality.ema = B;
    }
  }

  return { LADDER_BASE, quality, perf, buildLadder, applyQuality, setQualityMode, tickQuality };
}
