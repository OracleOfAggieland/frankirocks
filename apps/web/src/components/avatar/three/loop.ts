// Prototype franki.html 3337-3454 (section 14: the main loop), 3269-3272 (the pointer listener, from ui.init) and
// 3473-3477, 3481 (the start lines), ported in WP10. Allowed edits E1-E7, E11 (`_proj` re-declared for
// frameAboveDock) and the contract edits of design note §3.3 loop.ts:
// - no THREE.Timer: `rawDt = prevTs === null ? 0 : (ts - prevTs) / 1000`, unclamped, for perf.ema and tickQuality;
//   `dt = clamp(rawDt, 0, 0.05)`; prevTs is null after every run(), so the first frame back has dt 0;
// - `c0 = host.mono()`; frameInner applies a pending size first (queueResize), before the zero-size check;
// - tickQuality(dms, c0 / 1000) is stored after the draw and run at the top of the next frame, after the pending size,
//   so a tier change (setPixelRatio, setSize) never clears a frame that was just drawn; the ladder reads the same inputs;
// - feedProbes reads host.audio only while `targets.mic` / `targets.voice` is open, otherwise silence();
// - settle(): two frameInner calls with dt 0 that snap CH_LIST at 3380 and again after applyRig; in still mode it first
//   runs feedProbes(1/60) STILL_PREROLL times, so the still mouth never depends on the early frames' timing;
// - the try/catch of frame() reports to the loop machine (FRAME_ERROR_LIMIT bad frames in a row fail the engine);
// - removed: sim.update, call.tick, ui.tick, renderer.setAnimationLoop, the window resize listener, notify.
// The loop machine itself is the pure loopStep/loopRuns of ui/avatar/renderer-phase.ts. Nothing but send() starts
// or stops frames: after every event it calls run() or halt() from loopRuns. `running` mirrors that decision for
// the scheduler (the prototype's own name); it is never set anywhere else.
// Host events go out only once the engine is ready (life past "building"): before that, createEngine decides.
// Not ported from this range: `timer` (3340-3341, E7), `uiNext` and ui.tick (3342, 3396, E6), the `perf` object
// (3343, moved to quality.ts), the window resize listener (3439: the size observer calls queueResize), the
// prototype's wake at boot (3480: the app decides the look) and every line of 3478-3479 and 3482-3486.
import * as THREE from "three";
import { INITIAL_LOOP, type LoopEvent, type LoopState, loopRuns, loopStep } from "../../../ui/avatar/renderer-phase";
import { DEG, HOVER } from "./config";
import type { Rig } from "./context";
import { clamp } from "./math";

export interface EngineStats {
  fps: number;
  frameMs: number;
  cpuMs: number;
  /** `sm.shown`, as the prototype reports it. */
  state: string;
  /** `${quality.mode}:${tier}@${pr.toFixed(2)}`, the pixel ratio after E10. */
  quality: string;
  drawCalls: number;
  triangles: number;
  /** Frame and shader errors recorded since create, newest last, at most 20. */
  errors: string[];
}

export interface LoopPart {
  SUB: number;
  feedProbes(dt: number): void;
  /** The try/catch wrapper of 3358-3361. */
  frame(ts: number): void;
  frameInner(ts: number): void;
  stats(): EngineStats;
  frameAboveDock(w: number, h: number): void;
  resize(): void;
  /** contract: records a pending CSS size; frameInner applies it first (size.w, size.h, then resize()). */
  queueResize(w: number, h: number): void;
  watchDpr(): void;
  onDprChange(): void;
  /** 3474-3477 and 3481: buildLadder, watchDpr, setQualityMode(quality.mode), resize, scheduleBlink(0, 'idle'). */
  boot(): void;
  /**
   * contract: two frameInner calls with dt 0, snapping every channel (3380) after setTargets and after applyRig.
   * True when both frames drew (a zero-size box draws nothing). A frame error is thrown to the caller.
   */
  settle(): boolean;
  loopState(): LoopState;
  /** Steps the loop machine and requests or cancels the next frame to match loopRuns. */
  send(e: LoopEvent): void;
  /** pointermove (3269-3272, with the contract pointer edit), the DPR query, visibility and the two context listeners. */
  attach(): void;
  detach(): void;
  run(): void;
  halt(): void;
}

export function createLoop(rc: Omit<Rig, keyof LoopPart>): LoopPart {
  const {
    host, canvas, size, clock, targets, errors, recordError, STILL, REDUCED, audio,
    renderer, scene, camera, CAM_BASE, CAM_LOOK, makeStudioEnv, gradePass, brushTex, bgMat,
    CH, CH_LIST, gaze, scheduleBlink, updateBlink, updateGaze, updateMouth,
    sm, resolveState, setTargets, TIME_WRAP, applyRig, applyWorldFX, updateFX, camState, updateCamera,
    updateCatchLights, quality, perf, buildLadder, applyQuality, setQualityMode, tickQuality,
  } = rc;
  const _proj = new THREE.Vector3();                                         // E11: as declared at 2868; written before every read

  /* =====================================================================
     14. MAIN LOOP
     ===================================================================== */
  let acc = 0, frameN = 0, running = false;
  const SUB = 1 / 120;                                                        // fixed spring sub-step: identical motion at 60 and 144 Hz
  const STILL_PREROLL = 240;                                                  // contract: 4 s of 60 Hz probe steps before a still settle; the centroid's one-pole (60 ms) is at its float fixed point long before
  // contract: the rAF timestamp of the last frame (null after run(), so the first frame back has dt 0), the pending
  // size, the settle frames' snap, the loop machine and the scheduled frame.
  let prevTs: number | null = null;
  let pending: { w: number; h: number } | null = null;
  let settling = false;
  let state: LoopState = INITIAL_LOOP;
  let handle: unknown = null;
  // contract: the ladder's inputs from the last drawn frame. tickQuality runs at the top of the next frame, before the
  // draw, because a tier change resizes the canvas and a resize after the draw clears the frame just drawn (§2.3).
  const qualityTick = { due: false, dms: 0, t: 0 };

  function feedProbes(dt: number) {
    const m = audio.mic, v = audio.voice;
    const mr = targets.mic ? host.audio.read('mic', dt, m.time, m.db) : 0;   // contract: the mic gate
    if (mr > 0) m.sr = mr; else m.silence();
    const vr = targets.voice ? host.audio.read('voice', dt, v.time, v.db) : 0;   // contract: the voice gate
    if (vr > 0) v.sr = vr; else v.silence();
    m.analyse(dt, clock.T); v.analyse(dt, clock.T);
  }

  /** One bad frame must never blank the canvas for good: record it and carry on with the next one. */
  function frame(ts: number) {
    try { frameInner(ts); }
    catch (e) { recordError('frame', ((e as Error) && (e as Error).message) || String(e)); send('frame-error'); return; }   // contract: the loop machine counts it
    if (state.errors > 0) send('frame-ok');                                    // contract: only after a bad frame, so a normal frame allocates nothing
  }
  function frameInner(ts: number) {
    if (pending) { size.w = pending.w; size.h = pending.h; pending = null; resize(); }   // contract: the queued size, before the frame is drawn
    if (qualityTick.due) { qualityTick.due = false; tickQuality(qualityTick.dms, qualityTick.t); }   // contract: the last frame's tickQuality (3395), before this draw
    const c0 = host.mono();
    const rawDt = prevTs === null ? 0 : (ts - prevTs) / 1000;                  // contract (E7): replaces timer.update / getDelta
    prevTs = ts;
    const dt = clamp(rawDt, 0, 0.05);                                          // never negative: timer.reset() on a tab switch can land after the rAF stamp
    if (size.w < 1 || size.h < 1) return;                                      // hidden or zero-size pane: nothing to draw into
    if (!STILL) clock.T += dt;
    renderer.info.reset();
    feedProbes(dt);
    const { base, muted } = resolveState(clock.T);
    updateBlink(clock.T, dt, base);
    updateGaze(clock.T, base, muted);
    const speaking = base === 'speaking';
    updateMouth(clock.T, dt, speaking, base === 'thinking');
    setTargets(clock.T, dt, base, muted);
    CH.headSac.t *= Math.exp(-dt * 2.5);
    if (STILL || settling) for (const c of CH_LIST) c.snap(c.t);              // still frames are exact poses, independent of frame count
    else { acc += dt; while (acc >= SUB) { for (const c of CH_LIST) c.step(SUB); acc -= SUB; } }
    updateCamera(clock.T, dt);
    applyRig(clock.T, dt, base, muted);
    if (settling) for (const c of CH_LIST) c.snap(c.t);                        // contract: the follow-through channels applyRig targets start at rest
    scene.updateMatrixWorld();                                                 // the frame's only world-matrix pass (scene.matrixWorldAutoUpdate is off)
    applyWorldFX(clock.T, dt);
    updateFX(clock.T, dt, base, muted);
    updateCatchLights();
    gradePass.uniforms.uTime.value = STILL || REDUCED ? 0 : clock.T % TIME_WRAP;
    if (frameN % quality.ladder[quality.idx].every === 0) renderer.shadowMap.needsUpdate = true;   // three clears it after each shadow render
    renderer.render(scene, camera);
    frameN++;
    perf.cpu = host.mono() - c0;
    const dms = rawDt * 1000;
    if (dms > 0 && dms < 250) perf.ema += (dms - perf.ema) * 0.08;
    qualityTick.due = true; qualityTick.dms = dms; qualityTick.t = c0 / 1000;   // contract: tickQuality(dms, c0 / 1000) at the top of the next frame; the monotonic CPU clock, never the (possibly frozen) simulation clock
  }

  function stats(): EngineStats {
    const e = quality.ladder[quality.idx];
    return {
      fps: 1000 / Math.max(1, perf.ema), frameMs: perf.ema, cpuMs: perf.cpu, state: sm.shown, quality: `${quality.mode}:${e.tier}@${renderer.getPixelRatio().toFixed(2)}`,   // contract: cpuMs; the ratio after E10
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, errors: errors.slice(),
    };
  }

  /** Short or small screens: the dock is a fixed size, so pull back just enough that hair-to-hem fits above it, then lift the framing
      (a view offset, so rays and projections stay exact). The overlay never sits on Franki. */
  function frameAboveDock(w: number, h: number) {
    camera.clearViewOffset();
    const dockTop = rc.dockTop();                                               // E5: 0 in the app, so this returns at once
    if (!(dockTop > 0) || dockTop > h) return;
    const at = (y: number) => { camera.position.set(CAM_BASE.x, CAM_BASE.y, camState.dist); camera.lookAt(CAM_LOOK); camera.updateMatrixWorld(); _proj.set(0, y, 0).project(camera); return (1 - _proj.y) * 0.5 * h; };
    const limit = dockTop - 16, hemY = HOVER - 0.16, topY = HOVER + 2.1;          // hemY: the lowest lobe tip on a downward bob
    let hem = at(hemY);
    if (hem <= limit) return;
    for (let i = 0; i < 10 && hem - at(topY) > limit - 0.06 * h; i++) { camState.dist *= 1.05; hem = at(hemY); }
    const lift = Math.max(0, hem - limit);
    if (lift > 0) camera.setViewOffset(w, h, 0, lift, w, h);
  }
  function resize() {
    const w = size.w, h = size.h;
    if (w < 1 || h < 1) return;                                                // a hidden pane reports 0x0: keep the last good size
    camera.aspect = w / h;
    const fit = 1.25 / (Math.tan((camera.fov * DEG) / 2) * camera.aspect);      // keep about 2.5 units of width in view on portrait screens
    camState.dist = Math.max(CAM_BASE.z, fit * 1.12);
    camera.updateProjectionMatrix();
    frameAboveDock(w, h);
    bgMat.uniforms.uRes.value.set(w, h);
    applyQuality(quality.idx);
  }
  /** contract: the size observer's CSS size, applied by the next frame. */
  function queueResize(w: number, h: number) {
    pending = { w, h };
  }
  let dprMQ: MediaQueryList | null = null;
  function watchDpr() {
    if (dprMQ) dprMQ.removeEventListener('change', onDprChange);
    dprMQ = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprMQ.addEventListener('change', onDprChange);
  }
  function onDprChange() { const tier = quality.ladder[quality.idx].tier; buildLadder(); quality.idx = Math.max(0, quality.ladder.findIndex((e) => e.tier === tier)); resize(); watchDpr(); }

  /* --- contract: the loop machine (design note §5.2) in place of setAnimationLoop and `running` (3439-3453) --- */
  function loopState(): LoopState {
    return state;
  }
  function send(e: LoopEvent) {
    const prev = state;
    state = loopStep(state, e);
    if (prev.life === 'live' && state.life === 'failed') {
      host.onEvent({ kind: 'failed', reason: 'frames', detail: errors[errors.length - 1] ?? 'frame errors' });
    }
    if (loopRuns(state)) run(); else halt();
  }
  function tick(ts: number) {
    handle = null;
    if (!running) return;
    frame(ts);
    if (running) handle = host.scheduler.request(tick);
  }
  function run() {
    if (running) return;
    running = true;
    prevTs = null;                                                             // stands in for timer.reset() (3442, 3452)
    handle = host.scheduler.request(tick);
  }
  function halt() {
    if (!running) return;
    running = false;
    if (handle !== null) host.scheduler.cancel(handle);
    handle = null;
  }

  /* --- listeners: the pointer (3269-3272), visibility (3440-3443) and the context (3444-3454) --- */
  const onPointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();                                   // contract: the canvas's own NDC, unclamped
    if (r.width > 0 && r.height > 0) gaze.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    gaze.pointerWin.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);   // contract: the window NDC, for the parallax
    gaze.lastPointer = clock.T;
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    send('lost');                                                              // contract: replaces running = false; setAnimationLoop(null); notify
    if (state.life === 'live') host.onEvent({ kind: 'lost' });
  };
  const onRestored = () => {
    if (scene.environment) scene.environment.dispose();                         // contract: the old env texture is freed first
    scene.environment = makeStudioEnv();
    brushTex.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
    send('restored');                                                          // contract: replaces running = true; timer.reset(); setAnimationLoop(frame)
    if (state.life !== 'live') return;
    // contract: one good frame, then the host hears `restored`. Drawn here, so a held or hidden engine still proves
    // its context; a failed frame counts toward the limit and the SVG stays.
    prevTs = null;
    try { frameInner(0); }
    catch (err) { prevTs = null; recordError('frame', ((err as Error) && (err as Error).message) || String(err)); send('frame-error'); return; }
    prevTs = null;
    host.onEvent({ kind: 'restored' });
  };
  let unsubscribeVisibility: (() => void) | null = null;

  function attach() {
    if (unsubscribeVisibility) return;                                         // already attached
    addEventListener('pointermove', onPointer, { passive: true });
    unsubscribeVisibility = host.visibility.subscribe((visible) => send(visible ? 'show' : 'hide'));
    if (!host.visibility.isVisible()) send('hide');
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
  }
  function detach() {
    removeEventListener('pointermove', onPointer);
    if (unsubscribeVisibility) unsubscribeVisibility();
    unsubscribeVisibility = null;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    if (dprMQ) dprMQ.removeEventListener('change', onDprChange);
    dprMQ = null;
  }

  /* =====================================================================
     15. START (3474-3477, 3481)
     ===================================================================== */
  function boot() {
    buildLadder();
    watchDpr();
    setQualityMode(quality.mode);                                                // ?still=1 pins a fixed tier so captures repeat exactly
    resize();
    scheduleBlink(0, 'idle');
  }

  /** contract: a real frame of the current targets at once, with every spring at rest (design note §2.3). */
  function settle(): boolean {
    const n0 = frameN;
    settling = true;
    prevTs = null;
    try {
      // contract: still frames only. The probes reach the still signal's fixed point before updateMouth first sees it,
      // so the mouth driver's dominant shape (held 45 ms, which a frozen clock never releases) is the settled one and
      // never depends on the early frames' timing (§2.3, §8.2 item 1). Silence stays silence; live engines skip it.
      if (STILL) for (let i = 0; i < STILL_PREROLL; i++) feedProbes(1 / 60);
      frameInner(0); frameInner(0);
    }
    finally { settling = false; prevTs = null; }
    return frameN === n0 + 2;
  }

  return {
    SUB, feedProbes, frame, frameInner, stats, frameAboveDock, resize, queueResize, watchDpr, onDprChange,
    boot, settle, loopState, send, attach, detach, run, halt,
  };
}
