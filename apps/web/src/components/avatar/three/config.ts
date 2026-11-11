// Prototype franki.html 181-222 (section 1, CONFIG), ported in WP0. Allowed edits: E1, E3, E9 (design note §1.3).
// The URL parsing (186-200, `QS`, `STATES`, `clampNum`) is replaced by EngineOptions. URLP keeps the values the
// prototype has with no query string (plus `still` and `quality` from the options), so verbatim reads of it need
// no edit. The module constants are the same for every engine; STILL, REDUCED and URLP are per engine.
// E9: the comment at 210 loses the `#` of its hex (token-check scans comments).
import * as THREE from "three";

/* =====================================================================
   1. CONFIG
   ===================================================================== */
export const SHOW_MOUTH = true;                        // the art has no mouth; set false and the eyes, glow and squash carry speech alone

export type QualityMode = "auto" | "high" | "medium" | "low";

/** The app passes { still: false, quality: "auto" }; the specimens parity panel passes still: true. */
export interface EngineOptions {
  still: boolean;
  quality: QualityMode;
}

/** The prototype's URL parameters, fixed: zoom 1, fx 0 and NaN for fy and lids mean "not set". */
export interface Urlp {
  state: null;
  sim: boolean;
  quality: QualityMode;
  debug: boolean;
  still: boolean;
  rm: boolean;
  zoom: number;
  fy: number;
  fx: number;
  lids: number;
}

export interface ConfigPart {
  STILL: boolean;
  /** Always false: the app shows the SVG ghost under reduced motion. The prototype's REDUCED paths stay as they are. */
  REDUCED: boolean;
  URLP: Urlp;
}

export function createConfig(opts: EngineOptions): ConfigPart {
  const URLP: Urlp = { state: null, sim: false, quality: opts.quality, debug: false, still: opts.still, rm: false, zoom: 1, fy: NaN, fx: 0, lids: NaN };
  const STILL = URLP.still;
  const REDUCED = false;
  return { STILL, REDUCED, URLP };
}

export const STILL_T = 2.35;                           // the deterministic moment ?still=1 freezes at

export const C = (hex: number) => new THREE.Color(hex);
export const COL = {
  body: 0xD6F5CF, core: 0xEAFBDF, sheen: 0xF4FFEF, shadow: 0x93DDA2, sss: 0xC2F2AE, rimHem: 0x9EF07E, rimTop: 0xC9FFB0,
  ecto: 0x7CFFB2, ghostCool: 0xB9F0E0, blush: 0xF6B7A8, brow: 0x4F8A4C,
  hairBase: 0x2E2F34, hairMid: 0x2C2D32, hairTip: 0x45474D, hairRoot: 0x141518, hairBounce: 0x2E3A30, hairSheen: 0x505259,
  scarCut: 0x6E4A3A, scarGroove: 0x3B2A23, welt: 0xBFDDB0, hole: 0x7A9C72,
  brass: 0xD9A441, brassBase: 0xE8C27A,   /* metal F0 is linear: this pale-gold hex renders as warm brass; C99A4A rendered as orange plastic */ brassHi: 0xF3CF7A, brassShadow: 0x8A5E1F, brassDeep: 0x4A3210, gold: 0xFFD24D, spark: 0xFFF6D8,
  arcOuter: 0xFFB838, arcEdge: 0xFF8A1F,
  night0: 0x060A09, night1: 0x0B1311, night2: 0x13201C, lamp: 0x3A2412,
  bead: 0x080809, iris0: 0x0A0908, iris1: 0x15110E, rimRefl: 0x5E6066, catch2: 0xDFF7E6,
  mouthIn: 0x2E1A22, mouthDeep: 0x160C10, tongue: 0xE58A8C, tongueHi: 0xF4AFAE, mote: 0xF3E2C0,
};
export type ColName = keyof typeof COL;

export const HOVER = 0.30;                             // hem tip height above the floor at rest
export const TURN = THREE.MathUtils.degToRad(18);      // 3/4 view: the face points viewer-right, as in the art
export const HEAD_PIVOT = 0.95;                        // the head bends about this height; everything above it moves as one
export const EYE_X = 0.17, EYE_Y = 1.19;
export const BOLT_Y = 1.50;
export const DEG = Math.PI / 180;
