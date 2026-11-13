// The radio's own small three.js scene, on a clear canvas that stands on the stage's floor at Franki's lower left.
// It is separate from the ghost's engine and the phone's, as the phone is: the ghost's canvas is opaque and masked.
// The lights and the reflection studio repeat the phone's (a warm key from the upper left, a mint rim from behind,
// Franki's green glow from where Franki floats), so the oak and brass of the two props match.
import * as THREE from "three";
import { C, COL } from "../../avatar/three/config";
import { mulberry32 } from "../../avatar/three/math";
import { ARC_BOLTS, ARC_SEGMENTS, DIAL, type RadioModel, SPEAKER, FRONT_Z, buildRadio } from "./model";
import type { RadioPropView } from "../../../ui/radio/types";
import { BOB_HEIGHT, EASED_CHANNELS, INITIAL_RADIO_MOTION, type RadioMotion, radioTargets, settledRadioMotion, stepRadioMotion } from "./motion";

export interface RadioSize {
  /** CSS pixels. */
  w: number;
  h: number;
  dpr: number;
}

export interface RadioEngine {
  setView(view: RadioPropView): void;
  /** True while the pointer is over the radio or it has keyboard focus. */
  setHover(hover: boolean): void;
  resize(size: RadioSize): void;
  /** Advances the motion by `dt` seconds and draws one frame. A still engine draws the settled pose instead. */
  frame(dt: number): void;
  dispose(): void;
}

export interface RadioEngineOptions {
  /** Reduced_Motion: every frame is the settled pose for the view, so nothing sweeps, pulses or drifts. */
  still: boolean;
}

/** The canvas's width over its height. */
export const RADIO_CANVAS_ASPECT = 1;
/** The most device pixels drawn per CSS pixel. */
export const RADIO_MAX_DPR = 2;

const LOOK = new THREE.Vector3(0.06, 0.68, 0);
const CAM_DIST = 3.9;
const CAM_RISE = 0.85;
const CAM_FOV = 26;
/** Turned a little to the right, toward Franki, who floats at the radio's upper right. */
const RADIO_YAW = 0.42;

/** The phone's studio for reflections: a warm softbox upper left, a mint strip behind right, a warm bounce from below. */
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
  card(2.2, 2.2, COL.ecto, 0.5, 5.0, 1.4, 1.5);
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
export function createRadioEngine(canvas: HTMLCanvasElement, initial: RadioSize, view: RadioPropView, options: RadioEngineOptions): RadioEngine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power", stencil: false });
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, RADIO_CANVAS_ASPECT, 0.5, 20);
  camera.position.set(LOOK.x, LOOK.y + CAM_RISE, CAM_DIST);
  camera.lookAt(LOOK);

  const key = new THREE.DirectionalLight(C(COL.spark), 2.4);
  key.position.set(-3, 4.2, 4);
  const rim = new THREE.DirectionalLight(C(COL.rimTop), 1.5);
  rim.position.set(2.6, 2.9, -3.2);
  const hemi = new THREE.HemisphereLight(C(COL.ghostCool), C(COL.lamp), 0.55);
  // Franki's own glow, from where Franki floats: up and to the right.
  const ghostGlow = new THREE.PointLight(C(COL.ecto), 1.3, 5, 1.6);
  ghostGlow.position.set(2.0, 1.6, 1.2);
  scene.add(key, rim, hemi, ghostGlow);
  const env = studio(renderer);
  scene.environment = env;
  scene.environmentIntensity = 0.9;

  const model: RadioModel = buildRadio();
  model.root.rotation.y = RADIO_YAW;
  scene.add(model.root, ...model.drifters);

  const amber = C(COL.arcOuter), green = C(COL.ecto), ember = C(COL.arcEdge);
  const dialColor = new THREE.Color();
  const speakerAt = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();

  let current: RadioPropView = view;
  let hover = false;
  let motion: RadioMotion = INITIAL_RADIO_MOTION;
  let disposed = false;
  /** False once a resting radio has been drawn: nothing on it moves, so later frames are skipped until something changes. */
  let dirty = true;

  /** True when the radio is off and every eased channel has arrived: the picture can't change until the view does. */
  const resting = (m: RadioMotion): boolean => {
    if (current.power !== "off") return false;
    const target = radioTargets(current, hover);
    return EASED_CHANNELS.every((k) => Math.abs(m[k] - target[k]) < 1e-4);
  };

  const placeArcs = (m: RadioMotion) => {
    const on = m.arc > 0.01;
    model.arcGroup.visible = on;
    if (!on) return;
    (model.arcs[0]!.material as THREE.MeshBasicMaterial).opacity = m.arc;
    for (let b = 0; b < ARC_BOLTS; b++) {
      const rnd = mulberry32(m.arcSeed * 31 + b * 7 + 1);
      // One bolt leaps up and out to the left, the other up and a little right.
      let heading = b === 0 ? 2.1 + 0.5 * (rnd() - 0.5) : 1.15 + 0.5 * (rnd() - 0.5);
      from.set(0, 0, 0.01);
      for (let s = 0; s < ARC_SEGMENTS; s++) {
        const len = 0.045 + 0.04 * rnd();
        heading += (rnd() - 0.5) * 1.4;
        to.set(from.x + Math.cos(heading) * len, from.y + Math.sin(heading) * len, from.z);
        const seg = model.arcs[b * ARC_SEGMENTS + s]!;
        seg.position.lerpVectors(from, to, 0.5);
        seg.scale.y = len;
        seg.rotation.z = heading - Math.PI / 2;
        from.copy(to);
      }
    }
  };

  const apply = (m: RadioMotion) => {
    const { root, speaker, dialFace, dialGlow, needle, knobs, tip, tipGlow, sourceGlow, shadow, drifters } = model;
    root.position.y = m.bob * BOB_HEIGHT;
    const push = m.pulse;
    speaker.scale.set(1 + 0.02 * push, 1 + 0.02 * push, 1 + 0.4 * push);

    dialColor.copy(amber).lerp(green, m.green).lerp(ember, m.ember);
    dialFace.material.emissive.copy(dialColor);
    dialFace.material.emissiveIntensity = m.dial * 1.3;
    (dialGlow.material as THREE.SpriteMaterial).color.copy(dialColor);
    (dialGlow.material as THREE.SpriteMaterial).opacity = m.dial * 0.55;
    needle.position.x = DIAL.x - DIAL.reach + 2 * DIAL.reach * m.needle;

    knobs[0].rotation.z = -m.knob * 1.9;
    knobs[1].rotation.z = -m.knob * 1.2;

    tip.material.emissiveIntensity = 0.1 * m.dial + 0.9 * m.source + 1.2 * m.arc;
    (tipGlow.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.4 * m.source + 0.6 * m.arc);
    (sourceGlow.material as THREE.SpriteMaterial).opacity = 0.3 * m.source;
    (shadow.material as THREE.SpriteMaterial).opacity = 0.6 - 0.15 * m.bob;
    placeArcs(m);

    root.updateMatrixWorld(true);
    // The drifters leave the speaker and rise up and out toward Franki, fading as they go.
    speakerAt.set(SPEAKER.x, SPEAKER.y, FRONT_Z + 0.05);
    root.localToWorld(speakerAt);
    drifters.forEach((d, i) => {
      const p = (m.notes + i / drifters.length) % 1;
      d.position.set(speakerAt.x + 0.1 + 0.32 * p + 0.025 * Math.sin(p * 9 + i), speakerAt.y + 0.08 + 0.6 * p, speakerAt.z + 0.05);
      d.scale.setScalar(0.75 + 0.6 * p);
      d.rotation.z = i === 1 ? 0.2 * Math.sin(p * 6) : 0;
      // Still, only the first is drawn: one ring held mid-air.
      const shown = options.still && i > 0 ? 0 : 1;
      const alpha = shown * m.drift * Math.sin(Math.PI * p) ** 1.3 * 0.9;
      d.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (mat !== undefined) mat.opacity = alpha;
      });
      d.visible = alpha > 0.004;
    });
  };

  const resize = (size: RadioSize) => {
    if (disposed || size.w <= 0 || size.h <= 0) return;
    dirty = true;
    renderer.setPixelRatio(Math.min(size.dpr, RADIO_MAX_DPR));
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
      motion = options.still ? settledRadioMotion(current, hover) : stepRadioMotion(motion, current, hover, dt);
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
      // The canvas goes with the radio, so its context is freed now and not at the next collection.
      renderer.forceContextLoss();
    },
  };
}
