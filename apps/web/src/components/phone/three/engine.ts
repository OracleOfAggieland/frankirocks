// The wall phone's own small three.js scene, on a canvas with a clear background that lies over the stage beside
// Franki. It is separate from the ghost's engine: that canvas is opaque and masked to a circle, so nothing can hang
// outside it. The lights repeat the ghost's (a warm key from the upper left, a mint rim from behind, and the
// ghost's own green glow from the left), so the two read as one room. The engine lives only while a call is shown.
import * as THREE from "three";
import { C, COL } from "../../avatar/three/config";
import { HANDSET_CORD_Y, HANDSET_EAR_Y, HANDSET_REST, type PhoneModel, buildPhone } from "./model";
import { INITIAL_MOTION, type PhoneMotion, type ShownView, settledMotion, stepMotion } from "./motion";

export interface PhoneSize {
  /** CSS pixels. */
  w: number;
  h: number;
  dpr: number;
}

export interface PhoneEngine {
  setView(view: ShownView): void;
  resize(size: PhoneSize): void;
  /** Advances the motion by `dt` seconds and draws one frame. A still engine draws the settled pose instead. */
  frame(dt: number): void;
  dispose(): void;
}

/** The canvas's width over its height. The camera frames the phone on the right and Franki's ear on the left. */
export const PHONE_CANVAS_ASPECT = 1.2;
/** The most device pixels drawn per CSS pixel. */
export const PHONE_MAX_DPR = 2;

const CAM_X = -0.6;
const CAM_DIST = 5.2;
const CAM_FOV = 24;
/** The phone is turned a little toward Franki. */
const PHONE_YAW = -0.24;

/** A small studio for reflections: a warm softbox upper left, a mint strip behind right, a warm bounce from below. */
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
  card(2.2, 2.2, COL.ecto, 0.5, -5.0, 0.4, 1.5);
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

export interface PhoneEngineOptions {
  /** Reduced_Motion: every frame is the settled pose for the view, so nothing travels, shakes or pulses. */
  still: boolean;
}

/** Throws when the WebGL renderer can't be made; the caller then shows the words alone. */
export function createPhoneEngine(canvas: HTMLCanvasElement, initial: PhoneSize, view: ShownView, options: PhoneEngineOptions): PhoneEngine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power", stencil: false });
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, PHONE_CANVAS_ASPECT, 0.5, 20);
  camera.position.set(CAM_X, 0.12, CAM_DIST);
  camera.lookAt(CAM_X, 0, 0);

  const key = new THREE.DirectionalLight(C(COL.spark), 2.4);
  key.position.set(-3, 4.2, 4);
  const rim = new THREE.DirectionalLight(C(COL.rimTop), 1.5);
  rim.position.set(2.6, 2.9, -3.2);
  const hemi = new THREE.HemisphereLight(C(COL.ghostCool), C(COL.lamp), 0.55);
  // Franki's own glow, from where Franki stands.
  const ghostGlow = new THREE.PointLight(C(COL.ecto), 1.3, 5, 1.6);
  ghostGlow.position.set(-2.3, 0.3, 1.2);
  scene.add(key, rim, hemi, ghostGlow);
  const env = studio(renderer);
  scene.environment = env;
  scene.environmentIntensity = 0.9;

  const model: PhoneModel = buildPhone();
  model.root.rotation.y = PHONE_YAW;
  scene.add(model.root, ...model.waves, ...model.ticks);

  const qHook = new THREE.Quaternion().setFromEuler(HANDSET_REST.hook.rotation);
  const qEar = new THREE.Quaternion().setFromEuler(HANDSET_REST.ear.rotation);
  const qSway = new THREE.Quaternion();
  const swayAxis = new THREE.Vector3(0, 0, 1);
  const cordEnd = new THREE.Vector3();
  const lastCordEnd = new THREE.Vector3(Infinity, 0, 0);
  const earAt = new THREE.Vector3();
  const bellAt = new THREE.Vector3();
  const lampOff = C(COL.brassDeep), lampLive = C(COL.ecto), lampMissed = C(COL.arcEdge);
  const lampNow = new THREE.Color();

  let current: ShownView = view;
  let motion: PhoneMotion = { ...INITIAL_MOTION, phase: view.phase };
  let disposed = false;

  const apply = (m: PhoneMotion) => {
    const { root, handset, bells, clapper, wheel, lamp, lampGlow, waves, ticks } = model;
    root.scale.setScalar(0.9 + 0.1 * m.appear);
    root.position.y = (1 - Math.min(1, m.appear)) * -0.06;

    // The handset travels from the hook to Franki's ear on a shallow arc.
    const k = THREE.MathUtils.clamp(m.lift, -0.05, 1.08);
    handset.position.lerpVectors(HANDSET_REST.hook.position, HANDSET_REST.ear.position, k);
    handset.position.y += Math.sin(Math.PI * THREE.MathUtils.clamp(k, 0, 1)) * 0.1;
    handset.position.z += Math.sin(Math.PI * THREE.MathUtils.clamp(k, 0, 1)) * 0.12;
    handset.quaternion.slerpQuaternions(qHook, qEar, THREE.MathUtils.clamp(k, 0, 1));
    handset.quaternion.multiply(qSway.setFromAxisAngle(swayAxis, m.sway * 0.03 * THREE.MathUtils.clamp(k, 0, 1)));

    cordEnd.set(0, HANDSET_CORD_Y, 0).applyQuaternion(handset.quaternion).add(handset.position);
    if (cordEnd.distanceToSquared(lastCordEnd) > 0.004 * 0.004) {
      model.setCord(cordEnd);
      lastCordEnd.copy(cordEnd);
    }

    wheel.rotation.z = m.wheel;
    bells[0].rotation.z = m.bell * 0.06;
    bells[1].rotation.z = -m.bell * 0.06;
    bells[0].position.y = 0.745 + m.bell * 0.004;
    bells[1].position.y = 0.745 - m.bell * 0.004;
    clapper.rotation.z = m.clapper * 0.2;

    lampNow.copy(lampOff).lerp(m.lamp === "missed" ? lampMissed : lampLive, m.lamp === "off" ? 0 : m.lampLevel);
    (lamp.material as THREE.MeshBasicMaterial).color.copy(lampNow).multiplyScalar(1 + m.lampLevel * 1.4);
    (lampGlow.material as THREE.SpriteMaterial).color.copy(m.lamp === "missed" ? lampMissed : lampLive);
    (lampGlow.material as THREE.SpriteMaterial).opacity = m.lamp === "off" ? 0 : m.lampLevel * 0.85;

    root.updateMatrixWorld(true);
    // The waves leave the earpiece toward Franki.
    earAt.set(0, HANDSET_EAR_Y, 0.11);
    handset.localToWorld(earAt);
    waves.forEach((w, i) => {
      const p = (m.wavePhase + i / waves.length) % 1;
      w.position.set(earAt.x - 0.02, earAt.y, earAt.z + 0.05);
      w.scale.setScalar(0.08 + 0.24 * p);
      (w.material as THREE.MeshBasicMaterial).opacity = m.waves * (1 - p) ** 1.2;
    });
    // Strokes flash off each bell while it rings.
    ticks.forEach((tk, i) => {
      const bell = bells[i < 3 ? 0 : 1];
      bellAt.set(0, 0, 0.06);
      bell.localToWorld(bellAt);
      const fan = ((i % 3) - 1) * 0.55 + (i < 3 ? 0.5 : -0.5);
      const reach = 0.235 + 0.02 * m.bell * (i % 2 === 0 ? 1 : -1);
      tk.position.set(bellAt.x - Math.sin(fan) * reach, bellAt.y + Math.cos(fan) * reach, bellAt.z + 0.05);
      tk.rotation.z = fan;
      (tk.material as THREE.MeshBasicMaterial).opacity = m.ring * (0.55 + 0.45 * m.clapper * (i % 2 === 0 ? 1 : -1));
    });
  };

  const resize = (size: PhoneSize) => {
    if (disposed || size.w <= 0 || size.h <= 0) return;
    renderer.setPixelRatio(Math.min(size.dpr, PHONE_MAX_DPR));
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
  };
  resize(initial);

  return {
    setView(next) {
      current = next;
    },
    resize,
    frame(dt) {
      if (disposed) return;
      motion = options.still ? settledMotion(current) : stepMotion(motion, current, dt);
      apply(motion);
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      model.dispose();
      env.dispose();
      renderer.dispose();
      // The canvas is thrown away with the phone, so its context is freed now and not at the next collection.
      renderer.forceContextLoss();
    },
  };
}
