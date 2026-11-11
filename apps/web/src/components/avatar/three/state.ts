// Prototype franki.html 2755-2862 without 2760-2778 (listenState, startle and the cheer are not ported), ported in
// WP8. Allowed edits E1, E3, E5 and the contract edits of design note §2.3: resolveState takes the base from
// `targets.pose` (the call, sim, Listen and voice-gate branches and `ui.setTag` are removed), still mode mirrors the
// prototype's `?state=` paths through stillOverride, and a block is appended after the verbatim setTargets body.
// applyTargets and endOneShots are new. `targets` is a holder: written only by applyTargets, in place.
import type { Acting, OneShotCommand, Pose } from "../../../ui/avatar/acting";
import { type ConfigPart, SHOW_MOUTH } from "./config";
import type { HostPart } from "./context";
import type { LightningPart } from "./fx-lightning";
import { lerp, smooth } from "./math";
import type { ProbesPart } from "./probe";
import type { RigPart } from "./rig";

/** What the badge would read: a pose or one of the two overlays. */
export type Shown = Pose | "muted" | "celebrate";

export interface StateMemo {
  /** Null in the app. In still mode, stillOverride(targets) each frame, so still frames take the prototype's paths. */
  override: Shown | null;
  /** A memo of targets.pose: a change retunes the spring omegas and fires the change blink. */
  base: Pose;
  shown: Shown;
  since: number;
  lastCelebLoop: number;
}

export interface StatePart {
  sm: StateMemo;
  /** contract: 'muted' for ghost, 'celebrate' for the celebrate one-shot, otherwise the pose. Read only when STILL. */
  stillOverride(acting: Acting): Shown;
  resolveState(t: number): { base: Pose; muted: boolean };
  /** Verbatim 2816-2862, then the appended contract block (§2.3). */
  setTargets(t: number, dt: number, base: Pose, muted: boolean): void;
  /** contract: Object.assign(targets, next), then the one-shot command at clock.T. Commands are ignored when STILL. */
  applyTargets(next: Acting, command: OneShotCommand): void;
  /** contract: ends celebrate and wake playback at once (settle only): `celeb.active = false; celeb.cutAt = -1; wake.active = false`. */
  endOneShots(): void;
}

export function createState(rc: HostPart & ConfigPart & ProbesPart & RigPart & LightningPart): StatePart {
  const {
    clock, targets, STILL, URLP, audio, arcs,
    CH, BODY_CH, POSE_CH, ST, gaze, blink, celeb, wake, fxState, triggerBlink, scheduleBlink, startCelebrate, CELEB_CUT,
  } = rc;

/* =====================================================================
   10. STATE MACHINE
   ===================================================================== */
const sm: StateMemo = { override: URLP.state, base: 'idle', shown: 'idle', since: 0, lastCelebLoop: -9 };

// contract: the still-mode override, so still frames take the prototype's ?state= paths (§2.3, §8.2)
function stillOverride(acting: Acting): Shown {                            // contract
  return acting.ghost ? 'muted' : acting.oneShot === 'celebrate' ? 'celebrate' : acting.pose;   // contract
}                                                                           // contract

function resolveState(t: number) {
  sm.override = STILL ? stillOverride(targets) : null;                     // contract: the app decides the look; only still mode pins one
  const ov = sm.override;
  const muted = targets.ghost || ov === 'muted';
  let base: Pose;
  if (ov && ov !== 'muted' && ov !== 'celebrate') base = ov;               // a debug override still wins over the gate
  else base = targets.pose;                                                 // contract: the call, sim and Listen chain is the app's look (§2.1)
  if (!ST[base]) base = 'idle';                                             // overlays (muted, celebrate) are never a base pose
  // A pinned celebrate plays once (setOverride clears lastCelebLoop, so pinning it again replays), then holds a happy settled
  // pose (setTargets) with the badge still reading CELEBRATE until the override changes.
  if (ov === 'celebrate' && sm.lastCelebLoop < 0) { if (!celeb.active || celeb.cutAt >= 0) startCelebrate(t); sm.lastCelebLoop = t; }
  // Still frames freeze the clock, so there a celebrate lasts exactly as long as it is pinned; live, it plays out, or fades over
  // CELEB_CUT after an explicit state change (co.* offsets are added directly, so cutting them would pop).
  if (celeb.active && (STILL ? ov !== 'celebrate' : t - celeb.t0 > 1.6 || (celeb.cutAt >= 0 && t - celeb.cutAt > CELEB_CUT))) { celeb.active = false; celeb.cutAt = -1; }
  if (base !== sm.base) {
    sm.base = base; sm.since = t;
    const S = ST[base];
    for (const k of BODY_CH) CH[k].w = POSE_CH.has(k) ? Math.min(S.w, 8.5) : S.w;   // the whole body floats into a pose; faces and light can be quick
    if (base === 'listening') CH.up.vel -= 2.2;                            // anticipatory eye-widen
    gaze.next = 0;
  }
  const shown = (celeb.active && celeb.cutAt < 0) || ov === 'celebrate' ? 'celebrate' : muted ? 'muted' : base;
  if (shown !== sm.shown) {
    if (shown !== 'muted' && shown !== 'celebrate' && t - blink.last > 0.6) triggerBlink(false);   // celebrate has its own eye beats
    CH.ghost.w = shown === 'muted' ? 6.8 : 9.2;                            // dissolve in over ~700 ms, out over ~500 ms
    sm.shown = shown;
  }
  return { base, muted };
}

/* Per-frame targets for every channel, from the state, the audio and the transient layers. */
function setTargets(t: number, dt: number, base: Pose, muted: boolean) {
  const S = ST[base];
  const vA = base === 'speaking' ? audio.voice.a : 0;
  const micL = audio.mic.level;
  const listeningNow = base === 'listening';
  let up = S.up, lo = S.lo + (base === 'speaking' ? 0.06 * vA : 0), tilt = S.tilt, pupil = S.pupil + (base === 'speaking' ? 0.04 * vA : 0);
  if (muted && (base === 'idle' || base === 'listening')) { up = 0.32; tilt = 4; pupil = 0.40; lo = 0; }
  else if (muted) pupil = lerp(pupil, 0.40, 0.5);
  if (!SHOW_MOUTH && base === 'speaking') {                                 // without a mouth, the same weights drive lids, squash and pupil
    lo += 0.05 * CH.mE.v; pupil += 0.02 * CH.mO.v;
  }
  if (t - fxState.startleT < 0.3) { up -= 0.12 * (1 - (t - fxState.startleT) / 0.3); pupil -= 0.06; }
  if (listeningNow && !muted) { up -= 0.06 * smooth(0.15, 0.6, micL); pupil += 0.04 * smooth(0.15, 0.6, micL); }   // louder voice, wider and more engaged eyes
  pupil += 0.01 * Math.sin(2 * Math.PI * 0.3 * t);                          // hippus
  pupil += 0.02 * smooth(0.6, 1, Math.sin(t * 0.21 + 1.3)) * (STILL ? 0 : 1);   // an occasional soft focus
  CH.up.t = up; CH.lo.t = lo; CH.tilt.t = tilt; CH.pupil.t = pupil; CH.upAsym.t = S.upAsym;
  [CH.browLA.t, CH.browLY.t, CH.browLAng.t, CH.browRA.t, CH.browRY.t, CH.browRAng.t] = S.brow;
  CH.rise.t = S.rise; CH.lean.t = S.lean; CH.roll.t = S.roll; CH.yaw.t = S.yaw;
  CH.pitch.t = base === 'thinking' ? -5 : muted ? 2 : 0;                    // thinking tips the face up toward the gaze; ghost mode droops a touch
  CH.bob.t = muted ? 0.07 : S.bob; CH.bobF.t = muted ? 0.2 : S.bobF; CH.sway.t = S.sway; CH.rock.t = S.rock;
  CH.glow.t = Math.min(1.28, S.glow + 0.3 * vA * vA);                      // squared: the inner light pulses per syllable instead of sitting at the cap
  CH.rim.t = S.rim + (listeningNow || base === 'idle' ? 0.6 * micL : 0);
  CH.halo.t = S.halo + 0.2 * vA + 0.15 * (listeningNow ? micL : 0);
  CH.hue.t = S.hue; CH.glowShift.t = S.glowShift; CH.blush.t = S.blush;
  CH.boltE.t = S.boltE + (base === 'speaking' ? 0.25 * vA : 0);
  CH.ghost.t = muted ? 1 : 0;
  CH.arc.t = base === 'thinking' && (STILL || t - sm.since > 0.1) ? 1 : 0;
  CH.vsq.t = base === 'speaking' ? 1 - 0.035 * (SHOW_MOUTH ? vA : Math.max(vA, CH.mA.v + CH.mO.v)) : 1;
  CH.hemAmp.t = 0.012 + (base === 'speaking' ? 0.01 * vA : 0);
  CH.bloom.t = 0.42 + 0.08 * CH.ghost.v + 0.08 * CH.arc.v * arcs.env;      // the arcs are HDR and bloom on their own; a big boost greyed the eyes
  CH.thinkMouth.t = base === 'thinking' ? 1 : 0;
  {                                                                         // celebrate grin: an open smile from the launch to the landing
    const tc = STILL ? 0.55 : t - celeb.t0, cw = celeb.cutAt >= 0 ? 1 - smooth(0, CELEB_CUT, t - celeb.cutAt) : 1;
    CH.grin.t = celeb.active ? smooth(0.2, 0.34, tc) * (1 - smooth(1.05, 1.3, tc)) * cw : 0;
    // Pinned celebrate, once the hop has landed: hold a happy settled pose (soft smile, lifted brows, warm cheeks, a little
    // brighter) instead of replaying. It starts as the hop's own grin and brows fade, so the springs hand over without a dip.
    // ?still=1 keeps its deterministic apex frame (the hop never ends there while pinned).
    if (sm.override === 'celebrate' && !STILL && celeb.cutAt < 0 && (!celeb.active || tc > 1.05)) {
      CH.grin.t = Math.max(CH.grin.t, 0.45);
      CH.blush.t += 0.18; CH.pupil.t += 0.08; CH.up.t += 0.04;
      CH.browLA.t += 0.4; CH.browRA.t += 0.4; CH.browLY.t += 0.03; CH.browRY.t += 0.03; CH.browLAng.t += 3; CH.browRAng.t += 3;
      CH.glow.t = Math.min(1.28, CH.glow.t + 0.08); CH.halo.t += 0.12;
    }
  }
  CH.glint.t = base === 'idle' && !muted ? 1 : 0;
  if (listeningNow && audio.mic.onset && micL > 0.35 && t - fxState.lastNod > 0.35) { fxState.lastNod = t; CH.nod.vel += 14 / 0.6; }   // ~1 deg nod
  // contract: acting for the looks the prototype has no row for (design note §2.2, §2.3). Targets only, so the springs
  // ease; it runs after updateGaze and the lines above, so it wins each frame. The ghost overlay wins over the lid numbers.
  const overlay = targets.overlay;                                          // contract
  if (overlay === 'recovery' && !muted) { CH.up.t = 0.30; CH.tilt.t = -8; }   // contract: art direction section 4, worried lids
  if (overlay === 'awaiting' && !muted) { CH.up.t = 0; CH.pupil.t = 0.5; }    // contract: art direction section 5
  CH.approve.t = overlay === 'awaiting' ? 1 : 0;                            // contract: fades in the 2 deg, 0.8 Hz nod loop (apply.ts)
  CH.doze.t = overlay === 'dormant' ? 1 : 0;                                // contract: at 1 it holds wakeCurves(0): lids shut, glow x 0.2, body -0.15
  if (overlay === 'dormant') { CH.lookYaw.t = 0; CH.lookPitch.t = 0; CH.headSac.t = 0; CH.glint.t = 0; }   // contract: Dormant stills the head and the glint
  if (!STILL && !targets.electric) CH.arc.t = 0;                            // contract: no arcs without the look's electricity and the budget's grant (§4.4)
}

// contract: the only writer of `targets` (in place) and of the one-shot playback starts and cuts (§2.3)
function applyTargets(next: Acting, command: OneShotCommand) {             // contract
  Object.assign(targets, next);                                             // contract
  if (STILL) return;                                                        // contract: still frames take their one-shots from stillOverride
  if (command.celebrate === 'cut' && celeb.active && celeb.cutAt < 0) celeb.cutAt = clock.T;   // contract: the rule of 3329-3334, fade the hop out, no pop
  if (command.wake === 'cut' && wake.active && !wake.fired.has('strike')) { wake.active = false; CH.doze.snap(1); }   // contract: before the strike the doze pose is identical, so it takes over and eases to the new look; after it, the wake plays out
  if (command.wake === 'start') {                                           // contract
    wake.active = true; wake.t0 = clock.T; wake.fired.clear(); CH.doze.snap(0);   // contract: doze hands over the identical pose
    blink.doubleAt = -1; scheduleBlink(clock.T, 'idle'); gaze.next = 0;     // contract: the boot's timers (3481), so no blink lands on the eye-pop
  }                                                                         // contract
  if (command.celebrate === 'start') startCelebrate(clock.T);               // contract
}                                                                           // contract

// contract: settle only, so the first visible frame is the look at rest (§3.3 facade step 5)
function endOneShots() { celeb.active = false; celeb.cutAt = -1; wake.active = false; }   // contract

  return { sm, stillOverride, resolveState, setTargets, applyTargets, endOneShots };
}
