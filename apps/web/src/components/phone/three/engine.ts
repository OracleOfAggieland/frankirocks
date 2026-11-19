// The wall phone's own small three.js scene, on a canvas with a clear background that lies over the stage beside
// Franki. It is separate from the ghost's engine: that canvas is opaque and masked to a circle, so nothing can float
// outside it. The canvas holds the phone alone, up by Franki's shoulder, and nothing in it reaches Franki. The lights
// are the radio's and the X-ray machine's (a warm key from the upper left, a mint rim from behind, and the ghost's own
// green glow from where Franki floats), so the three props match. The engine lives only while a call is shown.
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

/** The canvas's width over its height: the phone, its lifted handset and the waves that leave it toward Franki. */
export const PHONE_CANVAS_ASPECT = 0.8;
/** The most device pixels drawn per CSS pixel. */
export const PHONE_MAX_DPR = 2;

/** Where the camera looks: left of the phone's middle, so the waves on its left have room. */
const LOOK = new THREE.Vector3(-0.25, 0.02, 0);
const CAM_DIST = 5.4;
/** Above, so the tops of the caps, the bells and the shelf catch the key light, as on the radio. */
const CAM_RISE = 1.1;
const CAM_FOV = 24;
/** The phone is turned toward Franki, who floats to its left, and shows its crank side. */
const PHONE_YAW = -0.32;
/** How far the phone rises and falls in its float, in model units (the cabinet is 0.74 wide). */
const FLOAT_HEIGHT = 0.035;
/** How far below its place the phone starts as it arrives. */
const ARRIVE_DROP = 0.16;

/**
 * The radio's studio for reflections (a warm softbox upper left, a mint strip behind right, a warm bounce from below),
 * with a soft card behind the camera for the phone's flat fronts and Franki's green turned down on the left.
 */
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
  // A broad soft card behind the camera, so the phone's flat varnished fronts carry a sheen as the radio's curves do.
  card(5.0, 3.0, COL.spark, 0.9, -1.2, 2.6, 6.5);
  // Franki's green, dimmer than on the radio: the bells face him, and their domes would turn green.
  card(2.2, 2.2, COL.ecto, 0.25, -5.0, 0.4, 1.5);
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
  /** Reduced_Motion: every frame is the settled pose for the view, so nothing travels, floats, shakes or pulses. */
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
  camera.position.set(LOOK.x, LOOK.y + CAM_RISE, CAM_DIST);
  camera.lookAt(LOOK);

  const key = new THREE.DirectionalLight(C(COL.spark), 2.4);
  key.position.set(-3, 4.2, 4);
  const rim = new THREE.DirectionalLight(C(COL.rimTop), 1.5);
  rim.position.set(2.6, 2.9, -3.2);
  const hemi = new THREE.HemisphereLight(C(COL.ghostCool), C(COL.lamp), 0.55);
  // Franki's own glow, from where Franki floats: to the left and below, low enough to edge the phone without
  // painting its bells green.
  const ghostGlow = new THREE.PointLight(C(COL.ecto), 0.6, 5, 1.6);
  ghostGlow.position.set(-2.6, -1.2, 0.5);
  scene.add(key, rim, hemi, ghostGlow);
  const env = studio(renderer);
  scene.environment = env;
  scene.environmentIntensity = 0.9;

  const model: PhoneModel = buildPhone();
  model.root.rotation.y = PHONE_YAW;
  scene.add(model.root, ...model.waves, ...model.ticks);

  const qHook = new THREE.Quaternion().setFromEuler(HANDSET_REST.hook.rotation);
  const qLifted = new THREE.Quaternion().setFromEuler(HANDSET_REST.lifted.rotation);
  const qSway = new THREE.Quaternion();
  const swayAxis = new THREE.Vector3(0, 0, 1);
  const cordEnd = new THREE.Vector3();
  const lastCordEnd = new THREE.Vector3(Infinity, 0, 0);
  const earAt = new THREE.Vector3();
  const bellAt = new THREE.Vector3();
  const lampOff = C(COL.brassDeep), lampLive = C(COL.ecto), lampMissed = C(COL.arcEdge);

  let current: ShownView = view;
  let motion: PhoneMotion = { ...INITIAL_MOTION, phase: view.phase };
  let disposed = false;

  const apply = (m: PhoneMotion) => {
    const { root, handset, bells, clapper, wheel, lamp, lampGlow, aura, waves, ticks } = model;
    const arrived = Math.min(1, m.appear);
    // The float: a slow rise and fall with a small nod, and a slower rock. The phone rises into place as it arrives.
    root.scale.setScalar(0.92 + 0.08 * m.appear);
    root.position.y = m.hover * FLOAT_HEIGHT - (1 - arrived) * ARRIVE_DROP;
    root.rotation.set(m.hover * 0.012, PHONE_YAW + m.rock * 0.05, m.rock * 0.025);

    // The handset drifts off its cradle to float just in front of the phone, and back.
    const k = THREE.MathUtils.clamp(m.lift, -0.05, 1.08);
    const k01 = THREE.MathUtils.clamp(k, 0, 1);
    handset.position.lerpVectors(HANDSET_REST.hook.position, HANDSET_REST.lifted.position, k);
    handset.position.y += Math.sin(Math.PI * k01) * 0.04 + m.sway * 0.012;
    handset.quaternion.slerpQuaternions(qHook, qLifted, k01);
    handset.quaternion.multiply(qSway.setFromAxisAngle(swayAxis, m.sway * 0.05));

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

    const lit = m.lamp === "off" ? 0 : m.lampLevel;
    lamp.material.emissive.copy(lampOff).lerp(m.lamp === "missed" ? lampMissed : lampLive, lit);
    lamp.material.emissiveIntensity = 0.8 + lit * 1.8;
    (lampGlow.material as THREE.SpriteMaterial).color.copy(m.lamp === "missed" ? lampMissed : lampLive);
    (lampGlow.material as THREE.SpriteMaterial).opacity = lit * 0.85;
    // Franki's glow behind the phone breathes with the float, and warms a little while the line is live.
    (aura.material as THREE.SpriteMaterial).opacity = Math.max(0, m.appear) * (0.3 + 0.04 * m.hover + (m.lamp === "live" ? 0.08 * lit : 0));

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
