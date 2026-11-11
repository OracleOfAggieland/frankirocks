// Prototype franki.html 2864-3109 (section 11: applyRig, applyWorldFX, updateFX and the camera), ported in WP9.
// Allowed edits E1, E3, E5 and the contract edits of design note §2.3 (doze at 2919, 2945 and 2965; the approve nod
// at 2934 and 2938; the fizzle gate at 3078 takes `(muted || targets.overlay === 'recovery')`), plus the pointer
// edit at 3089: the camera parallax reads `gaze.pointerWin`. `_proj` (2868) is also re-declared in loop.ts (E11).
import * as THREE from "three";
import type { Pose } from "../../../ui/avatar/acting";
import { DEG, HOVER, TURN } from "./config";
import type { Rig } from "./context";
import type { Ribbon } from "./fx-lightning";
import type { LoopPart } from "./loop";
import { clamp, lerp, smooth } from "./math";
import type { QualityPart } from "./quality";

export interface RigOut { glow: number; bodyY: number; ghost: number; halo: number }

export interface CamState { px: number; py: number; fy: number; dist: number }

export interface ApplyPart {
  TIME_WRAP: number;
  applyRig(t: number, dt: number, base: Pose, muted: boolean): void;
  rigOut: RigOut;
  applyWorldFX(t: number, dt: number): void;
  updateFX(t: number, dt: number, base: Pose, muted: boolean): void;
  camState: CamState;
  updateCamera(t: number, dt: number): void;
}

export function createApply(rc: Omit<Rig, keyof ApplyPart | keyof QualityPart | keyof LoopPart>): ApplyPart {
  const {
    targets, STILL, REDUCED, URLP, rnd, rr,
    camera, CAM_BASE, CAM_LOOK, keyLight, rimLight, LAMP_I, lampLight, arcLight, bloomPass,
    U, hairU, brassU, brassMat,
    root, tiltG, squashG, head, headInner, glowLight, eyes,
    bolts, hairPre, fur, furGeo, furMat, brassPre, mouthMat,
    groundU, moteMat, bgMat, UP_AXIS, emitSparks, updateSparks, jag, arcs, writeRibbons,
    CH, MOUTH_K, MOUTH_SHAPES, ph, gaze, blink, celeb, wake, mouthDrv, fxState,
    triggerBlink, celebCurves, CELEB_CUT, wakeCurves,
  } = rc;

  /* =====================================================================
     11. APPLY: channels -> transforms, uniforms, lights, FX
     ===================================================================== */
  const TIME_WRAP = 3600;                                                     // shader clocks wrap hourly: one tiny step an hour, never float drift
  const _m4 = new THREE.Matrix4(), _hp = new THREE.Vector3(), _proj = new THREE.Vector3(), _rootW = new THREE.Vector3();

  function applyRig(t: number, dt: number, base: Pose, muted: boolean) {
    const m = REDUCED ? 0.3 : 1;                                              // motion amplitude under prefers-reduced-motion
    const tc = STILL ? 0.55 : t - celeb.t0;
    const co = celebCurves(celeb.active ? tc : -1, celeb.cutAt >= 0 ? 1 - smooth(0, CELEB_CUT, t - celeb.cutAt) : 1);
    const wo = wakeCurves(t - wake.t0);
    const ghost = CH.ghost.v;
    const speaking = base === 'speaking';

    // one-shot events on the celebrate and wake timelines
    if (celeb.active && !STILL && celeb.cutAt < 0) {
      if (tc >= 0.38 && !celeb.fired.has('burst')) {
        celeb.fired.add('burst');
        for (const b of bolts) {
          if (REDUCED) b.flash = 0.6;
          else {
            emitSparks(b, 40 + Math.floor(rnd() * 12), 1.15, 1, 2.4); b.flash = 1;   // a real burst: more, bigger, brighter sparks
            arcs.shot(b.tip, b.tip.clone().addScaledVector(b.axis, 0.22).addScaledVector(UP_AXIS, 0.12), 0.25, t);
          }
        }
        fxState.motePush = 1; fxState.heat = 1;
      }
      if (tc >= 1.25 && !celeb.fired.has('blink')) { celeb.fired.add('blink'); triggerBlink(false); }
    }
    if (wake.active) {
      const tw = t - wake.t0;
      if (tw >= 0.35 && !wake.fired.has('strike')) {
        wake.fired.add('strike');
        for (const b of bolts) {
          b.flash = 1;
          if (!REDUCED) { arcs.shot(b.tip.clone().addScaledVector(b.axis, 0.25).add(new THREE.Vector3(0, 0.75, 0)), b.tip, 0.3, t, 0.03); emitSparks(b, 14, 0.8, 1); }
        }
        fxState.heat = 1;
      }
      if (tw > 1.4) wake.active = false;
    }

    // phases (frequency changes never pop because phase is integrated)
    const adv = STILL ? 0 : dt;
    ph.bob += 2 * Math.PI * CH.bobF.v * adv;
    ph.sway += 2 * Math.PI * 0.17 * adv;
    ph.rock += 2 * Math.PI * 0.12 * adv;
    ph.breath += 2 * Math.PI * (muted ? 0.16 : 0.22) * adv;
    ph.hem += (muted ? 0.6 : 0.9) * adv;
    // keep phases small so float32 uniforms never step on a demo left running for days (hem uses 1.7x and 1x: 20 pi keeps both periodic)
    ph.bob %= 2 * Math.PI; ph.sway %= 2 * Math.PI; ph.rock %= 2 * Math.PI; ph.breath %= 2 * Math.PI; ph.hem %= 20 * Math.PI;

    // body
    const bob = (REDUCED ? 0 : 1) * CH.bob.v * Math.sin(ph.bob);
    const celebDy = REDUCED ? 0 : co.dy;
    const bodyY = CH.rise.v + bob + CH.hop.v * m + celebDy + wo.sink - 0.15 * CH.doze.v;   // contract: the doze sink (§2.3)
    root.position.y = HOVER + bodyY;
    root.position.z = -0.06 * ghost;
    root.rotation.y = TURN + CH.yaw.v * DEG;
    tiltG.rotation.x = CH.lean.v * DEG;
    tiltG.rotation.z = (CH.sway.v * Math.sin(ph.sway) + CH.rock.v * Math.sin(ph.rock) + co.roll) * DEG * m;
    const breathSy = 1 + 0.012 * Math.sin(ph.breath) * m;
    const csy = 1 + (co.sy - 1) * (REDUCED ? 0.3 : 1);
    const sy = breathSy * (1 + (CH.vsq.v - 1) * m) * csy * (1 - 0.01 * blink.v);
    const sxz = 1 / Math.sqrt(sy);                                            // volume-preserving squash
    squashG.scale.set(sxz, sy, sxz);
    CH.hemY.t = bodyY;
    U.uHemLag.value = clamp((CH.hemY.v - bodyY) * 0.9, -0.08, 0.08);

    // head: art tilt to the character's left, listening tilt, nods, saccade micro-turns
    const nodLoop = 2 * Math.sin(2 * Math.PI * 0.8 * t) * CH.approve.v;     // contract: the awaiting-approval nod, 2 deg at 0.8 Hz (§2.3)
    head.rotation.set((CH.nod.v + CH.pitch.v + CH.lookPitch.v + nodLoop) * DEG * m, (CH.headSac.v + CH.yaw.v * 0.25 + CH.lookYaw.v) * DEG * m, -(3 + CH.roll.v) * DEG * (REDUCED ? 0.6 : 1), 'YXZ');   // contract: + nodLoop
    head.updateMatrix();
    U.uHeadRot.value.setFromMatrix4(_m4.makeRotationFromQuaternion(head.quaternion));
    // Hair follow-through: tips trail every head turn (roll, nods, pitch, look-at and saccade yaw), on slower springs.
    const rollNow = CH.roll.v + CH.nod.v + CH.pitch.v + CH.lookPitch.v + nodLoop, yawNow = CH.headSac.v + CH.lookYaw.v + 0.25 * CH.yaw.v;   // contract: + nodLoop
    CH.hairRoll.t = rollNow; CH.hairY.t = bodyY; CH.hairYaw.t = yawNow;
    hairU.uHairLag.value.set(clamp((CH.hairRoll.v - rollNow) * DEG * 0.5, -0.02, 0.02), clamp((CH.hairY.v - bodyY) * 0.55, -0.03, 0.03),   // the mop's tips flop and settle after a hop
      clamp((CH.hairYaw.v - yawNow) * DEG * 0.5, -0.02, 0.02) * m);

    // skin uniforms
    const flicker = CH.arc.v * arcs.env * 0.05 * Math.sin(t * 2 * Math.PI * 2);
    const glow = (CH.glow.v * lerp(1, 0.8, ghost) + co.glow + flicker) * wo.glow * lerp(1, 0.2, CH.doze.v);   // contract: the doze dims the glow (§2.3)
    U.uGlow.value = glow;
    U.uRim.value = CH.rim.v * lerp(1, 1.6, ghost);
    U.uHue.value = CH.hue.v - 0.04 * ghost + co.hue + 0.01 * fxState.heat;
    U.uGhost.value = ghost;
    U.uGlowShift.value = CH.glowShift.v;
    U.uBlush.value = CH.blush.v + co.blush;
    U.uThink.value = CH.arc.v * (1 - ghost) * 0.9;
    U.uBrowL.value.set(CH.browLA.v + co.brow * 0.6, CH.browLY.v + co.brow * 0.04 + mouthDrv.browLift, (CH.browLAng.v + co.brow * 4) * DEG);
    U.uBrowR.value.set(CH.browRA.v + co.brow * 0.6, CH.browRY.v + co.brow * 0.04 + mouthDrv.browLift, (CH.browRAng.v + co.brow * 4) * DEG);
    U.uHemAmp.value = CH.hemAmp.v * m + (celeb.active && !REDUCED ? 0.03 * Math.abs(co.dy) : 0);
    U.uHemPhase.value = ph.hem;
    const nubSway = 0.015 * Math.sin(2 * Math.PI * 0.7 * t) * m;
    const nl = REDUCED ? co.nubL * 0.3 : co.nubL, np = REDUCED ? co.nubP * 0.3 : co.nubP;
    U.uNub.value.set(nl, nubSway + np, nl, -nubSway + np);
    U.uBreath.value = Math.sin(ph.breath) * m;
    U.uTime.value = t % TIME_WRAP;

    // eyes
    const crescent = co.cres;
    const closed = Number.isFinite(URLP.lids) ? URLP.lids : Math.max(blink.v, wo.closed, CH.doze.v);   // contract: the doze shuts the lids (§2.3)
    // Lid-gaze coupling: both lids follow the look, up when the eyes look up and down when they look down (as real lids do).
    // On solid black beads this is what makes the look direction read from across the room. Thinking keeps its narrowed lid.
    const gy = clamp(CH.gazeY.v, -1, 1);
    const lidK = lerp(0.16, 0.04, CH.thinkMouth.v);
    const travel = 1 - 0.85 * Math.max(closed, crescent);                    // a shut lid recentres the bead, so it never pokes through
    U.uLidCover.value = Math.max(closed, 0.6 * crescent);
    const shut = smooth(0.55, 0.95, closed);
    U.uLidShut.value = shut;
    eyes.forEach((e, i) => {
      e.bead.castShadow = closed < 0.5;                                       // a shut bead's contact shadow would outline the closed lid
      e.ball.scale.z = 1 - 0.97 * shut;                                      // the shut bead sinks below the skin, so the lid rim can melt into the face
      let up = Math.max(0, CH.up.v + (i === 0 ? CH.upAsym.v : 0) + co.up * (1 - crescent) - lidK * gy);
      let lo = Math.max(0, CH.lo.v + 0.05 * Math.max(gy, 0) + 0.03 * Math.min(gy, 0));
      up = lerp(up, 0, crescent); lo = lerp(lo, 0.45, crescent);             // joy: a bold upside-down U of each eye stays open
      up = lerp(up, 1, closed); lo = lerp(lo, Math.max(lo, 0.15), closed);
      const L = e.lidMat.userData.u.uLid.value;
      L.set(up, lo, CH.tilt.v * 0.025, 0.55 * crescent);
      e.beadMat.userData.u.uLid.value.copy(L);
      e.beadMat.userData.u.uPupil.value = clamp(CH.pupil.v + co.pupil, 0.3, 0.66);
      e.beadMat.userData.u.uGaze.value.set(CH.gazeX.v, CH.gazeY.v);
      e.ball.rotation.set(-CH.gazeY.v * 12 * DEG * travel, CH.gazeX.v * 12 * DEG * travel, 0);   // enough travel for a black bead's look to read
      e.ball.position.set(CH.gazeX.v * 0.022 * travel, CH.gazeY.v * 0.02 * travel, 0);
    });

    // brass, hair and the electric bits
    fxState.heat = STILL ? (base === 'thinking' ? 0.8 : 0) : Math.max(0, fxState.heat - dt / 1.2);
    const glintT = (t % 6) / 6;
    brassU.uGlint.value = CH.glint.v * 0.45 * Math.sin(Math.PI * smooth(0.0, 0.25, glintT));
    brassU.uGlintPhase.value = glintT * Math.PI * 8;
    brassU.uBrassA.value = lerp(1, 0.6, ghost);
    hairU.uHairA.value = lerp(1, 0.45, ghost);
    hairU.uKeyI.value = lerp(1, 0.4, ghost);                                  // strand highlights dim with the ghost
    hairPre.visible = brassPre.visible = ghost > 0.01;
    fur.visible = furMat.uniforms.uFurN.value > 0 && furGeo.instanceCount > 0 && ghost < 0.75;
    const arcW = CH.arc.v * (1 - ghost) * (REDUCED ? 0.7 : 1);
    const arcPulse = REDUCED ? 0.8 + 0.2 * Math.sin(t * Math.PI) : 0.6 + 0.4 * arcs.env;
    brassMat.emissiveIntensity = 1.1 * (CH.boltE.v * lerp(1, arcPulse, CH.arc.v) + 0.5 * fxState.heat) * lerp(1, 0.4, ghost);
    for (const b of bolts) {
      b.flash = Math.max(0, b.flash - dt / 0.12);
      b.light.intensity = (0.32 * arcW * arcs.env + 1.4 * b.flash) * (REDUCED ? 0.4 : 1);   // a 120 ms gold flash: the sparks carry the burst, the caps stay metal
    }
    arcLight.intensity = 2.6 * arcW * arcs.env * (REDUCED ? 0.4 : 1);           // enough to light the fringe and forehead gold with each stroke
    if (arcW > 0.001) arcLight.position.copy(headInner.localToWorld(_hp.copy(arcs.mid)));
    glowLight.intensity = 2.0 * glow;
    lampLight.intensity = LAMP_I * (1 - 0.85 * ghost);                        // no warm kick on a ghost
    keyLight.shadow.intensity = 0.8 * (1 - 0.55 * ghost);
    bloomPass.strength = CH.bloom.v + co.bloom;

    // mouth
    const sh = mouthMat.uniforms.uShape.value;
    sh.set(0, 0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const wi = i === 0 ? CH.mC.v : i === 1 ? CH.mO.v : i === 2 ? CH.mA.v : CH.mE.v, S = MOUTH_SHAPES[i];
      sh.x += wi * S[0]; sh.y += wi * S[1]; sh.z += wi * S[2]; sh.w += wi * S[3];
    }
    const tk = CH.thinkMouth.v * (speaking ? 0 : 1);                          // the thinking slit blends in and out, never a one-frame swap
    if (tk > 0) { sh.x = lerp(sh.x, 0.05 * MOUTH_K, tk); sh.y = lerp(sh.y, 0, tk); sh.z = lerp(sh.z, -0.004, tk); sh.w = lerp(sh.w, 0.5, tk); }
    mouthMat.uniforms.uVis.value = CH.mouthVis.v;
    mouthMat.uniforms.uTongue.value = clamp(CH.tongue.v);
    rigOut.glow = glow; rigOut.bodyY = bodyY; rigOut.ghost = ghost; rigOut.halo = co.halo;
  }

  /* Ground, motes and the background halo follow the world transform, so they run after the frame's one scene.updateMatrixWorld(). */
  const rigOut: RigOut = { glow: 1, bodyY: 0, ghost: 0, halo: 0 };
  function applyWorldFX(t: number, dt: number) {
    const { glow, bodyY, ghost } = rigOut;
    root.getWorldPosition(_rootW);
    const h = clamp(bodyY / 0.3, -0.3, 1.2);
    groundU.uShC.value.set(_rootW.x, _rootW.z);
    groundU.uShR.value.set(0.72, 0.46).multiplyScalar(1 + 0.6 * Math.max(h, 0));   // a tight contact shadow right under the hem lobes
    groundU.uShA.value = 0.6 * (1 - 0.6 * Math.max(h, 0)) * (1 - 0.5 * ghost);
    groundU.uTurn.value = root.rotation.y;
    groundU.uPoolI.value = 0.25 * glow * (1 - 0.4 * Math.max(h, 0));
    fxState.motePush = Math.max(0, fxState.motePush - dt / 0.6);
    moteMat.uniforms.uPush.value = fxState.motePush * (REDUCED ? 0 : 1);
    moteMat.uniforms.uGhost.value.set(_rootW.x, _rootW.y + 0.9, _rootW.z);
    moteMat.uniforms.uTime.value = t % TIME_WRAP;
    _proj.set(_rootW.x, _rootW.y + 1.0, _rootW.z).project(camera);
    bgMat.uniforms.uHalo.value.set(_proj.x * 0.5 + 0.5, _proj.y * 0.5 + 0.5, 1 + 0.1 * (CH.halo.v - 1));
    bgMat.uniforms.uHaloI.value = (CH.halo.v + rigOut.halo) * glow * (1 + 0.03 * Math.sin(ph.breath));
  }

  /* Lightning, one-shot arcs, fizzles and sparks. */
  const _ribList = [] as Ribbon[], _ribPool = [] as Ribbon[];
  function updateFX(t: number, dt: number, base: Pose, muted: boolean) {
    const arcW = CH.arc.v * (1 - CH.ghost.v);
    if (arcW > 0.01) {
      if (REDUCED) { if (arcs.main.length !== 1 || t - arcs.lastRegen > 1.5) arcs.regen(t, true); arcs.env = 0.8 + 0.2 * Math.sin(t * Math.PI); }
      else {
        if (t >= arcs.nextRegen || arcs.main.length === 0) { arcs.regen(t, false); arcs.nextRegen = t + rr(0.06, 0.09); fxState.heat = Math.max(fxState.heat, 0.8); }
        arcs.env = (0.62 + 0.38 * Math.exp(-14 * (t - arcs.lastRegen))) * (STILL ? 1 : 0.85 + 0.15 * rnd());
      }
    } else arcs.env = 0;
    // Ribbon descriptors come from a pool that is reused every frame (no per-frame garbage).
    const list = _ribList; list.length = 0;
    let pi = 0;
    const rib = (pts: THREE.Vector3[], w: number, k: number, root?: boolean) => {
      const o = _ribPool[pi] || (_ribPool[pi] = { pts: null!, w: 0, k: 0, root: false });
      pi++; o.pts = pts; o.w = w; o.k = k; o.root = !!root; list.push(o);
    };
    const fadePrev = 1 - clamp((t - arcs.lastRegen) / 0.025);                // 25 ms crossfade between generations
    if (arcW > 0.01) {
      for (const s of arcs.main) rib(s.pts, s.w, s.k * arcW * arcs.env, s.root);
      if (fadePrev > 0) for (const s of arcs.prev) rib(s.pts, s.w, s.k * arcW * arcs.env * fadePrev * 0.5, s.root);   // the outgoing path is a ghost, not a second full arc
    }
    for (let i = arcs.fx.length - 1; i >= 0; i--) {
      const f = arcs.fx[i], age = t - f.born;
      if (age > f.dur) { arcs.fx.splice(i, 1); continue; }
      if (t >= f.next && !STILL) { f.pts = jag(f.from, f.to, 4, 0.3); f.next = t + 0.05; }
      rib(f.pts, f.w, (1 - age / f.dur) * (0.8 + 0.2 * rnd()), false);
    }
    writeRibbons(list);
    // contract: the recovery overlay fizzles as the ghost does (§2.3)
    if ((muted || targets.overlay === 'recovery') && base !== 'speaking' && !STILL && !REDUCED && t >= fxState.nextFizzle) {   // a small dim fizzle while muted
      const b = bolts[rnd() < 0.5 ? 0 : 1];
      emitSparks(b, 3, 0.5, 0.35); b.flash = 0.25;
      fxState.nextFizzle = t + rr(4, 7);
    }
    updateSparks(STILL ? 0 : dt);
  }

  /* Camera: long lens, breathing drift and damped pointer parallax; portrait screens pull back to fit. */
  const camState: CamState = { px: 0, py: 0, fy: 0, dist: CAM_BASE.z };
  function updateCamera(t: number, dt: number) {
    const tx = REDUCED || STILL ? 0 : gaze.pointerWin.x, ty = REDUCED || STILL ? 0 : gaze.pointerWin.y;   // contract: the parallax keeps the window's normalisation (§2.3)
    const k = 1 - Math.exp(-dt * 2.2);
    camState.px += (tx - camState.px) * k; camState.py += (ty - camState.py) * k;
    const kf = STILL ? 1 : 1 - Math.exp(-dt * 5);                             // still frames take the framing at once
    camState.fy += (Math.max(0, root.position.y - HOVER - 0.08) * 0.5 - camState.fy) * kf;   // tilt up after a hop so the head never leaves frame
    const drift = REDUCED || STILL ? 0 : 0.01;
    camera.position.set(
      CAM_BASE.x + camState.px * 0.15 + drift * Math.sin(t * 2 * Math.PI * 0.07),
      CAM_BASE.y + camState.py * 0.08 + drift * Math.sin(t * 2 * Math.PI * 0.05 + 1.3) + camState.fy * 0.5,
      camState.dist);
    if (URLP.zoom !== 1 || Number.isFinite(URLP.fy)) {
      const fy = Number.isFinite(URLP.fy) ? URLP.fy : CAM_LOOK.y;
      camera.position.y += fy - CAM_LOOK.y; camera.position.x += URLP.fx;
      camera.lookAt(CAM_LOOK.x + URLP.fx, fy, CAM_LOOK.z);
      if (camera.zoom !== URLP.zoom) { camera.zoom = URLP.zoom; camera.updateProjectionMatrix(); }
    } else camera.lookAt(CAM_LOOK.x, CAM_LOOK.y + camState.fy, CAM_LOOK.z);
    camera.updateMatrixWorld();
    U.uKeyDirV.value.subVectors(keyLight.position, keyLight.target.position).normalize().transformDirection(camera.matrixWorldInverse);
    U.uRimDirV.value.subVectors(rimLight.position, rimLight.target.position).normalize().transformDirection(camera.matrixWorldInverse);
    bgMat.uniforms.uPar.value.set(-camState.px * 0.06, -camState.py * 0.04);
  }

  return { TIME_WRAP, applyRig, rigOut, applyWorldFX, updateFX, camState, updateCamera };
}
