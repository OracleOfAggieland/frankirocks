// Prototype franki.html 3111-3207 (section 12: the quality ladder) and `perf` (3343, moved here), ported in WP9.
// Allowed edits E1, E3, E5 (`innerWidth`/`innerHeight` → `size.w`/`size.h`; `document.hidden` at 3164 →
// `!host.visibility.isVisible()`), E6 (`$('qualNow')`, `$('qualSel')` removed), E7, and E10 in applyQuality:
// `const pr = e.dpr * renderScaleFor(size.h, L[0].dpr)`, then `renderer.setPixelRatio(pr)`, mote `uPR` = pr and
// grade `uRes` = size × pr. buildLadder keeps its `window.devicePixelRatio` read.
import type { ConfigPart, QualityMode } from "./config";
import type { HostPart } from "./context";
import { notPorted } from "./errors";
import type { WorldFxPart } from "./fx-world";
import type { HairPart } from "./hair";
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
  return notPorted("renderScaleFor", cssHeight, topDpr);
}

export function createQuality(rc: HostPart & ConfigPart & StagePart & UniformsPart & HairPart & WorldFxPart): QualityPart {
  return notPorted("createQuality", rc);
}
