// Prototype franki.html 2531-2753 (section 9: the spring channels, the expression table, blink, gaze, celebrate,
// wake and the mouth driver), ported in WP8. Allowed edits E1, E3, E4 (`T` → `clock.T` at 2577) and the contract
// edits of design note §2.3: `doze: new Chan(0, 4)` and `approve: new Chan(0, 6)` appended to CH (they join
// CH_LIST, not BODY_CH), and `pointerWin` added to `gaze` (2564). The blink, celebrate and wake playback state is
// kept as the prototype has it: it is animation, and its exact beats are part of the look.
import * as THREE from "three";
import type { Pose } from "../../../ui/avatar/acting";
import type { CharacterPart } from "./character";
import { type ConfigPart, DEG, SHOW_MOUTH } from "./config";
import type { HostPart } from "./context";
import { Chan, type RandomPart, clamp, easeInOut, easeInQuad, easeOutCubic, lerp, smooth } from "./math";
import type { ProbesPart } from "./probe";
import type { StagePart } from "./stage";

export type { Pose };

/** The prototype's 52 channels (2534-2547), in its order. */
export type PrototypeChannel =
  | "up" | "lo" | "tilt" | "upAsym" | "pupil"
  | "browLA" | "browLY" | "browLAng" | "browRA" | "browRY" | "browRAng"
  | "rise" | "lean" | "roll" | "yaw" | "pitch" | "lookYaw" | "lookPitch"
  | "thinkMouth" | "glint" | "hairYaw" | "grin"
  | "bob" | "bobF" | "sway" | "rock"
  | "glow" | "rim" | "hue" | "halo" | "glowShift" | "blush"
  | "ghost" | "arc" | "boltE" | "bloom"
  | "mouthVis" | "vsq" | "hemAmp"
  | "gazeX" | "gazeY" | "headSac"
  | "nod" | "hop" | "hemY"
  | "hairRoll" | "hairY"
  | "mC" | "mO" | "mA" | "mE" | "tongue";

/** The two contract channels, appended after the prototype's (§2.3). */
export type ContractChannel = "doze" | "approve";

export type Channels = Record<PrototypeChannel | ContractChannel, Chan>;

/** A row of the expression table ST (2553-2558). brow = [left alpha, y, angle, right alpha, y, angle]. */
export interface Expression {
  up: number; lo: number; tilt: number; upAsym: number; pupil: number; brow: number[];
  rise: number; lean: number; roll: number; yaw: number;
  bob: number; bobF: number; sway: number; rock: number;
  glow: number; rim: number; hue: number; halo: number; glowShift: number; blush: number; boltE: number;
  w: number;
}

export interface Phases { bob: number; sway: number; rock: number; breath: number; hem: number }

export interface GazeState {
  next: number; micro: number; mx: number; my: number; tx: number; ty: number; ox: number; oy: number;
  /** The pointer in the canvas's own NDC, unclamped (contract edit at 3270): the gaze ray points at the real pointer. */
  pointer: THREE.Vector2;
  /** contract: the pointer normalised to the window, as the prototype's 3270 has it; read by the camera parallax (3089). */
  pointerWin: THREE.Vector2;
  lastPointer: number; thinkSide: number; ptrLook: boolean;
}

/** Blink playback: phase 0 open, 1 closing, 2 hold, 3 opening, plus a pending double (2565). */
export interface BlinkState { v: number; phase: number; t: number; next: number; slow: boolean; doubleAt: number; last: number; phraseDone: boolean }

/** Celebrate playback (2566). `fired` holds the beat names already played ('burst', 'blink'). */
export interface CelebState { active: boolean; t0: number; fired: Set<string>; cutAt: number }

/** Wake playback (2567). `fired` holds 'strike'. */
export interface WakeState { active: boolean; t0: number; fired: Set<string> }

export interface MouthDriver {
  dom: number; domT: number; overUntil: number; snapUntil: number; targets: number[];
  lastVoice: number; browLift: number; cm: number; cd: number;
}

export interface FxState { startleT: number; motePush: number; lastNod: number; nextFizzle: number; heat: number }

/** celebCurves' one reused output object (2674). */
export interface CelebOffsets {
  dy: number; sy: number; nubL: number; nubP: number; roll: number; cres: number; glow: number; halo: number;
  blush: number; brow: number; pupil: number; hue: number; up: number; bloom: number;
}

/** wakeCurves' one reused output object (2702). */
export interface WakeOffsets { closed: number; glow: number; sink: number }

export interface RigPart {
  CH: Channels;
  CH_LIST: Chan[];
  /** Narrowed from the scaffold's string[] so state.ts can index CH with it (`CH[k].w`, 2801) without a cast. */
  BODY_CH: PrototypeChannel[];
  POSE_CH: Set<string>;
  ST: Record<Pose, Expression>;
  MOUTH_K: number;
  MOUTH_SHAPES: number[][];
  ph: Phases;
  gaze: GazeState;
  blink: BlinkState;
  celeb: CelebState;
  wake: WakeState;
  mouthDrv: MouthDriver;
  fxState: FxState;
  scheduleBlink(t: number, state: Pose): void;
  triggerBlink(slow?: boolean): void;
  updateBlink(t: number, dt: number, state: Pose): void;
  GAZE_MAX: number;
  gazeToward(world: THREE.Vector3, out: { x: number; y: number }): { x: number; y: number };
  headLookAt(world: THREE.Vector3 | null): void;
  updateGaze(t: number, state: Pose, muted: boolean): void;
  CELEB_RISE: number;
  celebCurves(tc: number, wgt?: number): CelebOffsets;
  startCelebrate(t: number): void;
  CELEB_CUT: number;
  wakeCurves(tw: number): WakeOffsets;
  updateMouth(t: number, dt: number, speaking: boolean, thinking: boolean): number;
}

export function createRig(rc: HostPart & ConfigPart & RandomPart & ProbesPart & StagePart & CharacterPart): RigPart {
  const { clock, STILL, REDUCED, rnd, rr, audio, camera, eyes, head, content } = rc;

/* =====================================================================
   9. RIG: spring channels, expression table, eye, blink, celebrate, wake and mouth controllers
   ===================================================================== */
const CH: Channels = {
  up: new Chan(0.08, 16), lo: new Chan(0, 16), tilt: new Chan(0, 12), upAsym: new Chan(0, 12), pupil: new Chan(0.42, 7.5),
  browLA: new Chan(0), browLY: new Chan(0), browLAng: new Chan(0), browRA: new Chan(0), browRY: new Chan(0), browRAng: new Chan(0),
  rise: new Chan(0), lean: new Chan(0), roll: new Chan(0), yaw: new Chan(0), pitch: new Chan(0, 6), lookYaw: new Chan(0, 5), lookPitch: new Chan(0, 5),
  thinkMouth: new Chan(0, 10), glint: new Chan(0, 8), hairYaw: new Chan(0, 10, 0.5), grin: new Chan(0, 18),
  bob: new Chan(0.05, 4), bobF: new Chan(0.28, 3), sway: new Chan(1.5, 4), rock: new Chan(0, 4),
  glow: new Chan(1), rim: new Chan(1), hue: new Chan(0, 6), halo: new Chan(1, 6), glowShift: new Chan(0, 6), blush: new Chan(0.12, 8),
  ghost: new Chan(0, 6.8), arc: new Chan(0, 12), boltE: new Chan(0, 10), bloom: new Chan(0.42, 6),
  mouthVis: new Chan(0, 38), vsq: new Chan(1, 22), hemAmp: new Chan(0.012, 6),
  gazeX: new Chan(0, 55, 0.8), gazeY: new Chan(0, 55, 0.8), headSac: new Chan(0, 11),
  nod: new Chan(0, 14, 0.55), hop: new Chan(0, 16, 0.5), hemY: new Chan(0, 12, 0.6),
  hairRoll: new Chan(0, 10, 0.5), hairY: new Chan(0, 10, 0.5),
  mC: new Chan(1, 40), mO: new Chan(0, 40), mA: new Chan(0, 40), mE: new Chan(0, 40), tongue: new Chan(0, 30),
  doze: new Chan(0, 4), approve: new Chan(0, 6),                            // contract: Dormant's doze and Awaiting_Approval's nod weight (§2.3); in CH_LIST, not BODY_CH
};
const CH_LIST = Object.values(CH);
const BODY_CH: PrototypeChannel[] = ['browLA', 'browLY', 'browLAng', 'browRA', 'browRY', 'browRAng', 'rise', 'lean', 'roll', 'yaw', 'glow', 'rim', 'hue', 'halo', 'glowShift', 'blush', 'boltE'];
const POSE_CH = new Set(['rise', 'lean', 'roll', 'yaw']);

/* Expression table, tuned from section 5 of the art spec. brow = [left alpha, y, angle, right alpha, y, angle]; left is the character's left (+X). */
const ST: Record<Pose, Expression> = {
  idle: { up: 0.08, lo: 0, tilt: 0, upAsym: 0, pupil: 0.42, brow: [0, 0, 0, 0, 0, 0], rise: 0, lean: 0, roll: 0, yaw: 0, bob: 0.05, bobF: 0.28, sway: 1.5, rock: 0, glow: 1, rim: 1, hue: 0, halo: 1, glowShift: 0, blush: 0.12, boltE: 0, w: 8 },
  listening: { up: 0, lo: 0, tilt: -3, upAsym: 0, pupil: 0.48, brow: [0.5, 0.026, 5, 0.5, 0.026, 5], rise: 0.04, lean: 5, roll: 6, yaw: 0, bob: 0.03, bobF: 0.28, sway: 1.0, rock: 0, glow: 1.1, rim: 1, hue: 0, halo: 1.05, glowShift: 0, blush: 0.12, boltE: 0.15, w: 13.5 },
  thinking: { up: 0.28, lo: 0.08, tilt: 6, upAsym: 0.06, pupil: 0.38, brow: [0.62, 0.038, 11, 0.45, -0.01, -5], rise: -0.02, lean: 0, roll: 0, yaw: -8, bob: 0.035, bobF: 0.24, sway: 0.6, rock: 2, glow: 1, rim: 1, hue: 0.01, halo: 1.05, glowShift: 0.3, blush: 0.12, boltE: 0.8, w: 10.5 },
  speaking: { up: 0.10, lo: 0.06, tilt: 0, upAsym: 0, pupil: 0.44, brow: [0.3, 0, 2, 0.3, 0, 2], rise: 0, lean: 2, roll: 0, yaw: 0, bob: 0.04, bobF: 0.3, sway: 1.2, rock: 0, glow: 1, rim: 1.1, hue: 0, halo: 1.05, glowShift: 0, blush: 0.22, boltE: 0.08, w: 19 },
};
const MOUTH_K = 1.35;                                                       // mouth scale: readable at viewing distance
const MOUTH_SHAPES = [[0.10, 0.0, 0.010, 0.5], [0.07, 0.07, 0.0, 1.0], [0.16, 0.14, 0.004, 0.55], [0.21, 0.045, 0.030, 0.25]]
  .map(([w, h, smile, round]) => [w * MOUTH_K, h * MOUTH_K, smile * MOUTH_K, round]);   // closed, small-o, wide-ah, ee-smile

const ph: Phases = { bob: 0, sway: 0, rock: 0, breath: 0, hem: 0 };
const gaze: GazeState = { next: 0, micro: 0, mx: 0, my: 0, tx: 0, ty: 0, ox: 0, oy: 0, pointer: new THREE.Vector2(), lastPointer: -9, thinkSide: 0, ptrLook: false,
  pointerWin: new THREE.Vector2() };                                       // contract: the window-normalised pointer for the camera parallax (§2.3)
const blink: BlinkState = { v: 0, phase: 0, t: 0, next: 1.5, slow: false, doubleAt: -1, last: -9, phraseDone: true };
const celeb: CelebState = { active: false, t0: 0, fired: new Set<string>(), cutAt: -1 };
const wake: WakeState = { active: false, t0: 0, fired: new Set<string>() };
const mouthDrv: MouthDriver = { dom: 0, domT: -9, overUntil: -9, snapUntil: -9, targets: [1, 0, 0, 0], lastVoice: -9, browLift: 0, cm: 0.25, cd: 0.05 };
const fxState: FxState = { startleT: -9, motePush: 0, lastNod: -9, nextFizzle: 5, heat: 0 };

function scheduleBlink(t: number, state: Pose) {
  const k = state === 'listening' ? 1.4 : state === 'thinking' ? 0.7 : 1;
  blink.next = t + clamp(2.5 + -Math.log(1 - rnd() * 0.97) * 1.3, 2.5, 6) * k;    // gamma-ish, mean ~3.8 s
}
function triggerBlink(slow = false) {
  if (STILL || blink.phase !== 0) return;
  blink.phase = 1; blink.t = 0; blink.slow = slow; blink.last = clock.T;
}
function updateBlink(t: number, dt: number, state: Pose) {
  if (STILL) { blink.v = 0; return; }
  if (blink.phase === 0 && state === 'speaking') {                         // blink at phrase boundaries: 180 ms under 0.08, 40% of the time
    const quietFor = t - audio.voice.lastLoud;
    if (quietFor >= 0.18 && !blink.phraseDone) { blink.phraseDone = true; if (rnd() < 0.4) { triggerBlink(false); scheduleBlink(t, state); } }
    if (quietFor < 0.18) blink.phraseDone = false;
  }
  if (blink.phase === 0) {
    if (blink.doubleAt > 0 && t >= blink.doubleAt) { blink.doubleAt = -1; triggerBlink(false); }
    else if (t >= blink.next) { triggerBlink(state === 'thinking'); scheduleBlink(t, state); if (rnd() < 0.12) blink.doubleAt = t + 0.18 + 0.22; }
  }
  if (blink.phase === 0) { blink.v = 0; return; }
  blink.t += dt;
  const close = blink.slow ? 0.16 : 0.07, hold = 0.03, open = 0.12;
  if (blink.phase === 1) { blink.v = easeInQuad(clamp(blink.t / close)); if (blink.t >= close) { blink.phase = 2; blink.t = 0; } }
  else if (blink.phase === 2) { blink.v = 1; if (blink.t >= hold) { blink.phase = 3; blink.t = 0; } }
  else { blink.v = 1 - easeOutCubic(clamp(blink.t / open)); if (blink.t >= open) { blink.phase = 0; blink.v = 0; } }
}

/* Gaze in normalised units (+-1 = the iris's full travel), in the FACE frame (head orientation, from between the eyes). The left
   socket alone is splayed ~14 deg outward, which pinned every look at the camera against the travel limit. */
const _gw = new THREE.Vector3(), _gw2 = new THREE.Vector3(), _gq = new THREE.Quaternion(), _gd = new THREE.Vector3(), _ray = new THREE.Raycaster(), _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -2.2);
const GAZE_MAX = 28 * DEG;
function gazeToward(world: THREE.Vector3, out: { x: number; y: number }) {
  eyes[0].socket.getWorldPosition(_gw); eyes[1].socket.getWorldPosition(_gw2); _gw.add(_gw2).multiplyScalar(0.5);
  head.getWorldQuaternion(_gq);
  _gd.subVectors(world, _gw).applyQuaternion(_gq.invert());
  out.x = clamp(Math.atan2(_gd.x, _gd.z) / GAZE_MAX, -1, 1);
  out.y = clamp(Math.atan2(_gd.y, Math.hypot(_gd.x, _gd.z)) / GAZE_MAX, -1, 1);
  return out;
}
const _camG = { x: 0, y: 0 }, _ptrG = { x: 0, y: 0 }, _ptrW = new THREE.Vector3(), _hw = new THREE.Vector3(), _hq = new THREE.Quaternion();
/** Head share of a look: the head turns ~40% of the way toward what the eyes track, so the beads never sit pinned at the edge of
    their travel (the 3/4 turn alone puts the camera ~20 deg off the eye axis). Measured in the body frame, so there is no feedback. */
function headLookAt(world: THREE.Vector3 | null) {
  if (!world) { CH.lookYaw.t = 0; CH.lookPitch.t = 0; return; }
  head.getWorldPosition(_hw); content.getWorldQuaternion(_hq);
  _gd.subVectors(world, _hw).applyQuaternion(_hq.invert());
  CH.lookYaw.t = clamp(Math.atan2(_gd.x, _gd.z) / DEG * 0.4, -12, 12);
  CH.lookPitch.t = clamp(-Math.atan2(_gd.y, Math.hypot(_gd.x, _gd.z)) / DEG * 0.3, -6, 6);
}
function updateGaze(t: number, state: Pose, muted: boolean) {
  gazeToward(camera.position, _camG);
  const camLook = state === 'listening' || state === 'speaking';
  if (STILL) {                                                              // still frames hold the state's signature look, head share included
    headLookAt(camLook ? camera.position : null);
    if (state === 'thinking') { CH.gazeX.t = -0.6; CH.gazeY.t = 0.6; } else { CH.gazeX.t = _camG.x; CH.gazeY.t = _camG.y; }
    return;
  }
  const slow = muted ? 1.5 : 1;
  if (t >= gaze.next) {
    // Old and new targets in the same terms, so a jump is measured where the eyes really were.
    const ox = camLook ? _camG.x + gaze.ox : gaze.tx, oy = camLook ? _camG.y + gaze.oy : gaze.ty;
    gaze.ox = gaze.oy = 0;
    if (state === 'listening') { gaze.next = t + rr(1.2, 2.2); }
    else if (state === 'thinking') {
      gaze.thinkSide ^= 1;
      gaze.tx = gaze.thinkSide ? -0.6 : -0.42; gaze.ty = gaze.thinkSide ? 0.6 : 0.74;
      gaze.next = t + rr(2, 3);
    } else if (state === 'speaking') {
      // Talkers hold eye contact with small drifts, and now and then glance away to gather a thought.
      if (rnd() < 0.18) { gaze.ox = rr(0.25, 0.4) * (rnd() < 0.5 ? -1 : 1); gaze.oy = rr(-0.05, 0.25); gaze.next = t + rr(0.45, 0.8); }
      else { gaze.ox = rr(-0.1, 0.1); gaze.oy = rr(-0.06, 0.06); gaze.next = t + rr(0.8, 1.5); }
    } else if (t - gaze.lastPointer < 2.5) {
      _ray.setFromCamera(gaze.pointer, camera);
      if (_ray.ray.intersectPlane(_plane, _ptrW)) gaze.ptrLook = true;
      gaze.next = t + rr(0.25, 0.5);
    } else {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.25;
      gaze.tx = clamp(_camG.x * 0.85 + Math.cos(a) * r, -1, 1); gaze.ty = clamp(_camG.y * 0.85 + Math.sin(a) * r * 0.8, -1, 1);
      gaze.next = t + rr(1.2, 3.5) * slow;
    }
    const nx = camLook ? _camG.x + gaze.ox : gaze.tx, ny = camLook ? _camG.y + gaze.oy : gaze.ty;
    const big = Math.hypot(nx - ox, ny - oy) > 0.25;
    if (big && !REDUCED && rnd() < 0.7) triggerBlink(false);
    if (rnd() < 0.4) CH.headSac.t = clamp((nx - ox) * 2.4, -1.5, 1.5);    // micro head turn, lagging via its slower spring
  }
  if (!(state === 'idle' && t - gaze.lastPointer < 2.5)) gaze.ptrLook = false;
  const ptr = state === 'idle' && gaze.ptrLook;
  if (ptr) {                                                                // live every frame: eyes and head follow the same point as it moves
    _ray.setFromCamera(gaze.pointer, camera); _ray.ray.intersectPlane(_plane, _ptrW);
    gazeToward(_ptrW, _ptrG); gaze.tx = _ptrG.x; gaze.ty = _ptrG.y;
  }
  headLookAt(camLook ? camera.position : ptr ? _ptrW : null);
  if (REDUCED) gaze.mx = gaze.my = 0;                                       // reduced motion: smooth gaze, no micro-saccades
  else if (t >= gaze.micro) { gaze.mx = rr(-0.06, 0.06); gaze.my = rr(-0.06, 0.06); gaze.micro = t + rr(0.4, 0.8); }
  const thinkingTrack = state === 'thinking' ? 0 : 1;
  // Camera looks read the camera direction live, so the eyes stay on the viewer while the head turns under them.
  const tx = camLook ? _camG.x + gaze.ox : gaze.tx, ty = camLook ? _camG.y + gaze.oy : gaze.ty;
  CH.gazeX.t = tx + gaze.mx * thinkingTrack; CH.gazeY.t = ty + gaze.my * thinkingTrack;
  CH.gazeX.w = CH.gazeY.w = REDUCED ? 8 : muted ? 36 : 55;
}

/* Celebrate: anticipation, launch, apex, fall, soft landing, settle (about 1.6 s). Returns additive offsets. */
const CELEB_RISE = 0.32;                                                     // with the camera's tilt-follow the hair stays in frame at 16:9
const _celebO: CelebOffsets = { dy: 0, sy: 1, nubL: 0, nubP: 0, roll: 0, cres: 0, glow: 0, halo: 0, blush: 0, brow: 0, pupil: 0, hue: 0, up: 0, bloom: 0 };
/** Writes the celebrate offsets at time tc into one reused object, scaled by wgt (a cut fades every offset back to rest). */
function celebCurves(tc: number, wgt = 1) {
  const o = _celebO;
  o.dy = 0; o.sy = 1; o.nubL = 0; o.nubP = 0; o.roll = 0; o.cres = 0; o.glow = 0; o.halo = 0; o.blush = 0; o.brow = 0; o.pupil = 0; o.hue = 0; o.up = 0; o.bloom = 0;
  if (tc < 0 || tc > 1.6 || wgt <= 0) return o;
  if (tc < 0.18) { const k = easeInOut(tc / 0.18); o.dy = -0.06 * k; o.sy = 1 - 0.12 * k; o.nubL = -0.03 * k; o.up = 0.15 * k; }
  else if (tc < 0.38) { const k = easeOutCubic((tc - 0.18) / 0.2); o.dy = lerp(-0.06, CELEB_RISE, k); o.sy = lerp(0.88, 1.14, k); o.nubL = lerp(-0.03, 0.10, k); o.nubP = 0.07 * k; o.up = 0.15 * (1 - k); }
  else if (tc < 0.70) { const k = (tc - 0.38) / 0.32; o.dy = CELEB_RISE + 0.02 * Math.sin(Math.PI * k); o.sy = lerp(1.14, 1.02, easeOutCubic(k)); o.nubL = 0.10; o.nubP = 0.07; }
  else if (tc < 1.05) { const k = easeInQuad((tc - 0.70) / 0.35); o.dy = lerp(CELEB_RISE, 0, k); o.sy = lerp(1.02, 1.0, k); o.nubL = 0.10 * (1 - k); o.nubP = 0.07 * (1 - k); }
  else if (tc < 1.20) { const s = Math.sin(Math.PI * (tc - 1.05) / 0.15); o.dy = -0.02 * s; o.sy = 1 - 0.07 * s; }
  else { const u = tc - 1.20, e = Math.exp(-0.45 * 12 * u) * Math.sin(12 * Math.sqrt(1 - 0.45 * 0.45) * u); o.dy = 0.012 * e; o.sy = 1 + 0.02 * e; o.roll = e; }   // damped spring, omega 12, zeta 0.45
  if (tc >= 0.32 && tc < 1.05) { const k = (tc - 0.32) / 0.73; o.roll = 6 * Math.sin(4 * Math.PI * k) * Math.sin(Math.PI * k); }   // a 2-cycle joy wiggle (~2.7 Hz, not a 6 Hz shiver)
  o.cres = smooth(0.34, 0.42, tc) * (1 - smooth(0.74, 0.82, tc));        // happy crescent eyes for ~400 ms at the apex
  const apex = smooth(0.30, 0.45, tc), decay = tc < 0.45 ? 1 : Math.exp(-(tc - 0.45) / 0.35), fade = 1 - smooth(1.15, 1.6, tc);
  o.glow = 0.28 * apex * decay; o.halo = 0.4 * apex * decay;            // the sparks and the bolt flash carry the burst; the body only brightens a little
  o.blush = 0.23 * apex * fade; o.brow = apex * fade;
  o.pupil = 0.16 * apex * fade; o.hue = 0.03 * apex * decay; o.bloom = 0.3 * apex * decay;
  if (wgt < 1) {
    o.dy *= wgt; o.sy = 1 + (o.sy - 1) * wgt; o.nubL *= wgt; o.nubP *= wgt; o.roll *= wgt; o.cres *= wgt; o.glow *= wgt; o.halo *= wgt;
    o.blush *= wgt; o.brow *= wgt; o.pupil *= wgt; o.hue *= wgt; o.up *= wgt; o.bloom *= wgt;
  }
  return o;
}
function startCelebrate(t: number) { celeb.active = true; celeb.t0 = t; celeb.cutAt = -1; celeb.fired.clear(); }   // no blink at the start: the anticipation squint must read
const CELEB_CUT = 0.25;                                                     // an explicit state change fades the celebrate out over 250 ms

/* Wake ("It's alive!"): eyes shut and dim, a strike on both bolts, glow flare, eyes pop open, rise. */
const _wakeO: WakeOffsets = { closed: 0, glow: 1, sink: 0 };
function wakeCurves(tw: number) {
  const o = _wakeO;
  if (!wake.active) { o.closed = 0; o.glow = 1; o.sink = 0; return o; }
  o.closed = tw < 0.55 ? 1 : 1 - smooth(0.55, 0.64, tw);
  o.glow = tw < 0.35 ? 0.2 : tw < 0.5 ? lerp(0.2, 2.0, (tw - 0.35) / 0.15) : lerp(2.0, 1.0, smooth(0.5, 1.3, tw));
  o.sink = -0.15 * (1 - smooth(0.5, 1.15, tw));
  return o;
}

const _mw = [1, 0, 0, 0];
function updateMouth(t: number, dt: number, speaking: boolean, thinking: boolean) {
  const vp = audio.voice;
  if (vp.level > 0.08) mouthDrv.lastVoice = t;
  let open = speaking ? vp.a : 0;
  if (speaking && vp.syllable) {
    mouthDrv.overUntil = t + 0.07;
    CH.nod.vel += 1.5 * 14 / 0.6;                                         // ~1.5 deg nod on each syllable onset
    mouthDrv.browLift = 0.01 * vp.a;
  }
  mouthDrv.browLift *= Math.exp(-dt * 5);                                // frame-rate independent (0.92 per frame at 60 Hz)
  if (t < mouthDrv.overUntil) open = clamp(open + 0.15);
  if (speaking && vp.plosive) mouthDrv.snapUntil = t + 0.05;
  if (t < mouthDrv.snapUntil) open = 0;
  // Vowel colour from the centroid relative to this voice's own running mean and spread (~2 s), so every voice
  // (the sim, a deep or a bright real voice) uses all three shapes instead of sitting in one fixed band.
  if (STILL) { mouthDrv.cm = 0.25; mouthDrv.cd = 0.05; }                   // fixed reference: a still frame never drifts with capture time
  else if (vp.level > 0.08) {
    const k = 1 - Math.exp(-dt / 2);
    mouthDrv.cm += (vp.cent - mouthDrv.cm) * k;
    mouthDrv.cd += (Math.max(0.02, Math.abs(vp.cent - mouthDrv.cm)) - mouthDrv.cd) * k;
  }
  const z = (vp.cent - mouthDrv.cm) / mouthDrv.cd;
  const wHigh = smooth(0.3, 1.1, z), wLow = smooth(-0.3, -1.1, z), wMid = Math.max(0, 1 - wHigh - wLow);
  const w = _mw;
  w[0] = 1 - open; w[1] = open * wLow; w[2] = open * wMid; w[3] = open * wHigh;
  const sum = w[0] + w[1] + w[2] + w[3] || 1;
  let dom = 0;
  for (let i = 0; i < 4; i++) { w[i] /= sum; if (w[i] > w[dom]) dom = i; }
  const tg = mouthDrv.targets;
  if (dom !== mouthDrv.dom) {
    if (t - mouthDrv.domT >= 0.045) { mouthDrv.dom = dom; mouthDrv.domT = t; for (let i = 0; i < 4; i++) tg[i] = w[i]; }   // never flutter faster than ~12 Hz
  } else for (let i = 0; i < 4; i++) tg[i] = w[i];
  // Celebrate: a happy open grin from the launch to the landing (the eyes alone read as blank at the apex).
  const g = CH.grin.v;
  CH.mC.t = lerp(tg[0], 0, g); CH.mO.t = lerp(tg[1], 0, g); CH.mA.t = lerp(tg[2], 0.4, g); CH.mE.t = lerp(tg[3], 0.6, g);
  CH.tongue.t = Math.max(clamp(smooth(0.45, 0.7, open) * tg[2] * 1.2) * (1 - g), 0.7 * g);   // only on wide-open 'ah' (and the joy grin), never at rest
  const visible = SHOW_MOUTH && speaking && (vp.a > 0.02 || t - mouthDrv.lastVoice < 0.4);
  CH.mouthVis.t = Math.max(visible ? 1 : SHOW_MOUTH && thinking ? 0.3 : 0, SHOW_MOUTH ? g : 0);
  CH.mouthVis.w = CH.mouthVis.t > CH.mouthVis.v ? 38 : 18;                // in over ~120 ms, out over ~250 ms
  return open;
}

  return {
    CH, CH_LIST, BODY_CH, POSE_CH, ST, MOUTH_K, MOUTH_SHAPES, ph, gaze, blink, celeb, wake, mouthDrv, fxState,
    scheduleBlink, triggerBlink, updateBlink, GAZE_MAX, gazeToward, headLookAt, updateGaze,
    CELEB_RISE, celebCurves, startCelebrate, CELEB_CUT, wakeCurves, updateMouth,
  };
}
