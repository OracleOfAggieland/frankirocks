// The X-ray machine's own small three.js scene, on a clear canvas that stands on the stage's floor at Franki's lower
// right, the radio's mirror image. It is separate from the ghost's engine, the phone's and the radio's: the ghost's
// canvas is opaque and masked. The lights and the reflection studio repeat the radio's (a warm key from the upper
// left, a mint rim from behind), with Franki's green glow mirrored to where Franki floats, up and to the left, so the
// oak and brass of the three props match.
import * as THREE from "three";
import { C, COL } from "../../avatar/three/config";
import { mulberry32 } from "../../avatar/three/math";
import type { XrayPropView } from "../../../ui/xray/types";
import { APERTURE_Z, ARC_BOLTS, ARC_SEGMENTS, FRONT_Z, NEEDLE_SWING, SCREEN, TERMINAL, type XrayModel, armAngles, buildXray } from "./model";
import { EASED_CHANNELS, INITIAL_XRAY_MOTION, type XrayMotion, settledXrayMotion, stepXrayMotion, xrayTargets } from "./motion";

export interface XraySize {
  /** CSS pixels. */
  w: number;
  h: number;
  dpr: number;
}

export interface XrayEngine {
  setView(view: XrayPropView): void;
  /** True while the pointer is over the machine or it has keyboard focus. */
  setHover(hover: boolean): void;
  resize(size: XraySize): void;
  /** Advances the motion by `dt` seconds and draws one frame. A still engine draws the settled pose instead. */
  frame(dt: number): void;
  dispose(): void;
}

export interface XrayEngineOptions {
  /** Reduced_Motion: every frame is the settled pose for the view, so nothing flickers, scans or crackles. */
  still: boolean;
}

/** The canvas's width over its height. */
export const XRAY_CANVAS_ASPECT = 1;
/** The most device pixels drawn per CSS pixel. */
export const XRAY_MAX_DPR = 2;

const LOOK = new THREE.Vector3(0.22, 0.84, 0);
const CAM_DIST = 4.3;
const CAM_RISE = 0.7;
const CAM_FOV = 26;
/** Turned a little to the left, toward Franki, who floats at the machine's upper left: the radio's mirror image. */
export const XRAY_YAW = -0.42;
/** How far the head sways with its hum, in radians. */
const HUM_SWAY = 0.03;

/** The radio's studio for reflections: a warm softbox upper left, a mint strip behind right, a warm bounce from below. */
function studio(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const O = new THREE.Vector3();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ color: C(COL.night2), side: THREE.BackSide })));
  const card = (w: number, h: number, col: number, k: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: C(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(O);
    env.add(m);
  };
  card(3.6, 2.6, COL.spark, 5.0, -3.4, 4.6, 4.4);
  card(0.9, 5.5, COL.rimTop, 2.6, 5.0, 1.4, -3.4);
  card(6.0, 0.7, COL.arcOuter, 1.8, 0.0, -2.2, 4.0);
  card(1.6, 1.6, COL.spark, 1.8, 3.6, 2.2, 4.2);
  card(2.2, 2.2, COL.ecto, 0.5, -5.0, 1.4, 1.5);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.04).texture;
  pm.dispose();
  env.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
  return tex;
}

/** Throws when the WebGL renderer can't be made; the caller then shows the words alone. */
export function createXrayEngine(canvas: HTMLCanvasElement, initial: XraySize, view: XrayPropView, options: XrayEngineOptions): XrayEngine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power", stencil: false });
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, XRAY_CANVAS_ASPECT, 0.5, 20);
  camera.position.set(LOOK.x, LOOK.y + CAM_RISE, CAM_DIST);
  camera.lookAt(LOOK);

  const key = new THREE.DirectionalLight(C(COL.spark), 2.4);
  key.position.set(-3, 4.2, 4);
  const rim = new THREE.DirectionalLight(C(COL.rimTop), 1.5);
  rim.position.set(2.6, 2.9, -3.2);
  const hemi = new THREE.HemisphereLight(C(COL.ghostCool), C(COL.lamp), 0.55);
  // Franki's own glow, from where Franki floats: up and to the left.
  const ghostGlow = new THREE.PointLight(C(COL.ecto), 1.3, 5, 1.6);
  ghostGlow.position.set(-2.0, 1.6, 1.2);
  // The glass's own light on the machine's front and the arm, driven with the glass.
  const screenLight = new THREE.PointLight(C(COL.ecto), 0, 1.6, 2);
  scene.add(key, rim, hemi, ghostGlow);
  const env = studio(renderer);
  scene.environment = env;
  scene.environmentIntensity = 0.9;

  const model: XrayModel = buildXray();
  model.root.rotation.y = XRAY_YAW;
  model.root.add(screenLight);
  screenLight.position.set(SCREEN.x, SCREEN.y, FRONT_Z + 0.25);
  scene.add(model.root);

  const amber = C(COL.arcOuter), green = C(COL.ecto), ember = C(COL.arcEdge), filmGrey = C(COL.ghostCool);
  const boneWhite = C(COL.catch2);
  const tint = new THREE.Color();
  const boneTint = new THREE.Color();
  const glassAt = new THREE.Vector3(SCREEN.x, SCREEN.y, FRONT_Z);
  const parkedAt = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const headAt = new THREE.Vector3();
  const windowAt = new THREE.Vector3();
  const beamDir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const mid = new THREE.Vector3();

  let current: XrayPropView = view;
  let hover = false;
  let motion: XrayMotion = INITIAL_XRAY_MOTION;
  let disposed = false;
  /** False once a resting machine has been drawn: nothing on it moves, so later frames are skipped until something changes. */
  let dirty = true;

  /** True when the machine is off and every eased channel has arrived: the picture can't change until the view does. */
  const resting = (m: XrayMotion): boolean => {
    if (current.power !== "off") return false;
    const target = xrayTargets(current, hover);
    return EASED_CHANNELS.every((k) => Math.abs(m[k] - target[k]) < 1e-4);
  };

  /** The arc: each bolt leaps from the left electrode to the right, bowed upward and jagged, a new shape each tick. */
  const placeArcs = (m: XrayMotion) => {
    const on = m.arc > 0.01;
    model.arcGroup.visible = on;
    (model.arcGlow.material as THREE.SpriteMaterial).opacity = Math.min(1, m.arc * 0.85);
    model.arcGlow.visible = on;
    if (!on) return;
    (model.arcs[0]!.material as THREE.MeshBasicMaterial).opacity = m.arc;
    for (let b = 0; b < ARC_BOLTS; b++) {
      const rnd = mulberry32(m.arcSeed * 37 + b * 11 + 3);
      const bow = 0.02 + 0.035 * rnd();
      from.set(-TERMINAL.x, 0, 0);
      for (let s = 0; s < ARC_SEGMENTS; s++) {
        const f = (s + 1) / ARC_SEGMENTS;
        const last = s === ARC_SEGMENTS - 1;
        to.set(-TERMINAL.x + 2 * TERMINAL.x * f, last ? 0 : bow * Math.sin(Math.PI * f) + (rnd() - 0.5) * 0.03, last ? 0 : (rnd() - 0.5) * 0.02);
        const seg = model.arcs[b * ARC_SEGMENTS + s]!;
        mid.lerpVectors(from, to, 0.5);
        seg.position.copy(mid);
        beamDir.subVectors(to, from);
        seg.scale.y = Math.max(beamDir.length(), 1e-4);
        seg.quaternion.setFromUnitVectors(UP, beamDir.normalize());
        from.copy(to);
      }
    }
  };

  const apply = (m: XrayMotion) => {
    const { root, glass, bones, scanLine, screenGlow, dialFace, needle, knob, filament, valveGlow, shoulder, elbow, head, aperture, apertureGlow, beam, shadow } = model;

    // The glass: amber leaning to green, then to ember or bare film, as bright as the motion says.
    tint.copy(amber).lerp(green, m.green).lerp(filmGrey, m.film * 0.8).lerp(ember, m.ember);
    glass.material.emissive.copy(tint);
    glass.material.emissiveIntensity = m.screen * 1.35;
    (screenGlow.material as THREE.SpriteMaterial).color.copy(tint);
    (screenGlow.material as THREE.SpriteMaterial).opacity = m.screen * 0.42;
    screenLight.color.copy(tint);
    screenLight.intensity = m.screen * 0.9;
    // The bones go with the glass's brightness, so they flicker and blink with it.
    boneTint.copy(boneWhite).lerp(filmGrey, m.film * 0.5);
    bones.material.color.copy(boneTint);
    bones.material.opacity = Math.min(1, m.bones * Math.min(1, m.screen * 1.25 + 0.05));
    bones.visible = bones.material.opacity > 0.004;
    scanLine.material.color.copy(boneTint);
    scanLine.material.opacity = m.scanAlpha * Math.min(1, m.screen * 1.4) * 0.75;
    scanLine.visible = scanLine.material.opacity > 0.004;
    scanLine.position.y = SCREEN.y + SCREEN.h * (0.42 - 0.84 * m.scanY);

    dialFace.material.emissiveIntensity = 0.55 * m.knob;
    needle.rotation.z = NEEDLE_SWING - 2 * NEEDLE_SWING * m.needle;
    knob.rotation.z = -m.knob * 1.7;
    filament.material.color.copy(amber).multiplyScalar(0.15 + 0.85 * m.valve);
    (valveGlow.material as THREE.SpriteMaterial).opacity = m.valve * 0.55;

    // The arm: the two joints from the pose, then the head turned from its parked gaze to the glass.
    const { shoulder: a1, elbow: a2 } = armAngles(m.aim);
    shoulder.rotation.x = a1;
    elbow.rotation.x = a2;
    root.updateMatrixWorld(true);
    head.getWorldPosition(headAt);
    root.worldToLocal(headAt);
    // Parked, the head looks out and up; aimed, at the middle of the glass.
    parkedAt.set(headAt.x + 0.35, headAt.y + 0.45, headAt.z + 0.55);
    lookAt.lerpVectors(parkedAt, glassAt, m.aim);
    root.localToWorld(lookAt);
    head.lookAt(lookAt);
    head.rotateY(m.hum * HUM_SWAY);
    head.rotateX(m.hum * HUM_SWAY * 0.6);
    head.updateMatrixWorld(true);

    aperture.material.color.copy(green).multiplyScalar(0.08 + 0.92 * m.aperture);
    (apertureGlow.material as THREE.SpriteMaterial).opacity = m.aperture * 0.8;
    placeArcs(m);

    // The beam, from the head's window to the glass.
    const beamOn = m.beam * m.screen > 0.004;
    beam.visible = beamOn;
    if (beamOn) {
      windowAt.set(0, 0, APERTURE_Z);
      head.localToWorld(windowAt);
      root.worldToLocal(windowAt);
      beamDir.subVectors(glassAt, windowAt);
      const len = beamDir.length();
      beam.position.copy(windowAt);
      beam.quaternion.setFromUnitVectors(UP, beamDir.normalize());
      beam.scale.set(1, len, 1);
      beam.material.opacity = 0.14 * m.beam * Math.min(1, m.screen * 1.2);
    }

    (shadow.material as THREE.SpriteMaterial).opacity = 0.6;
  };

  const resize = (size: XraySize) => {
    if (disposed || size.w <= 0 || size.h <= 0) return;
    dirty = true;
    renderer.setPixelRatio(Math.min(size.dpr, XRAY_MAX_DPR));
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
  };
  resize(initial);

  return {
    setView(next) {
      current = next;
      dirty = true;
    },
    setHover(next) {
      hover = next;
      dirty = true;
    },
    resize,
    frame(dt) {
      if (disposed) return;
      motion = options.still ? settledXrayMotion(current, hover) : stepXrayMotion(motion, current, hover, dt);
      const rest = options.still || resting(motion);
      if (rest && !dirty) return;
      dirty = !rest;
      apply(motion);
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      model.dispose();
      env.dispose();
      renderer.dispose();
      // The canvas goes with the machine, so its context is freed now and not at the next collection.
      renderer.forceContextLoss();
    },
  };
}
