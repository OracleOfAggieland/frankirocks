// The X-ray screen's three.js scene (brief 051 part C), on a clear canvas over the camera's picture. Each frame:
//   1. the film's decoration (grain, a scan line, a little flicker), unless still;
//   2. the veil: a soft darkening of the canvas's alpha over the face and each hand, and a faint line round the face;
//   3. the skull, placed by XrayFace.matrix in front of a camera XRAY_CAMERA_FOV degrees tall at the picture's aspect,
//      then the screen correction (fit.ts), the mirror and the cover fit (screen-map.ts) on its projection;
//   4. the hands, in hand space under a flat camera over the picture, with the same mirror and cover fit.
// Bone is added over the picture and never darkens it; the veil only darkens. The renderer discipline is the radio
// globe's: alpha with clear alpha 0, a device-pixel cap, and on dispose everything freed and the context lost.
import * as THREE from "three";
import { XRAY_CAMERA_FOV, type XrayFace, type XrayFrame, type XrayHand } from "../../../ui/xray/types";
import { COL } from "../../avatar/three/config";
import { FACE_OVAL } from "./canonical";
import { type FitCorrection, IDENTITY_FIT, correctionNdc, faceCorrection } from "./fit";
import { buildHand, type HandModel } from "./hand";
import { handRig, handSpace } from "./hand-rig";
import { type ScreenFit, coverFit, ndcScale } from "./screen-map";
import { buildSkull } from "./skull";
import { type Quat, approach, approachQuat, fade } from "./smooth";
import { VEIL_DEPTH, faceVeil, handVeil } from "./veil";

export interface BonesSize {
  /** CSS pixels. */
  w: number;
  h: number;
  dpr: number;
}

export interface BonesEngineOptions {
  /** Reduced_Motion: no grain, scan line or flicker. The bones still follow the person. */
  readonly still: boolean;
}

export interface BonesEngine {
  /** The selfie camera is drawn mirrored (ruling 9). */
  setMirrored(mirrored: boolean): void;
  resize(size: BonesSize): void;
  /** Eases toward `frame` by `dt` seconds and draws. A null frame fades everything out. */
  frame(dt: number, frame: XrayFrame | null): void;
  dispose(): void;
}

/** The most device pixels drawn per CSS pixel. */
export const BONES_MAX_DPR = 2;
/** How fast the pose and the points catch up with the tracker, seconds to cover half the gap. */
export const POSE_HALF_LIFE = 0.045;
export const POINT_HALF_LIFE = 0.035;
/** How many soft discs one hand's veil may use. */
const MAX_DISCS = 160;
const SIDES = ["left", "right"] as const;

const raw = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

interface FaceTrack {
  presence: number;
  seen: boolean;
  pos: THREE.Vector3;
  quat: Quat;
  scale: THREE.Vector3;
  jaw: number;
  corr: FitCorrection;
  /** The face oval's picture points, x and y interleaved. */
  oval: number[];
  target: { pos: THREE.Vector3; quat: Quat; scale: THREE.Vector3; jaw: number; corr: FitCorrection; oval: number[] } | null;
}

interface HandTrack {
  presence: number;
  seen: boolean;
  /** 21 picture points, x y z interleaved. */
  points: number[];
  target: number[] | null;
}

const ease = (cur: number[], target: readonly number[], dt: number, h: number) => {
  for (let i = 0; i < cur.length; i++) cur[i] = approach(cur[i]!, target[i]!, dt, h);
};

/** The hand in each slot: by its side, and a second hand on the same side takes the free slot. */
export function handSlots(hands: readonly XrayHand[]): Record<"left" | "right", XrayHand | null> {
  const out: Record<"left" | "right", XrayHand | null> = { left: null, right: null };
  for (const h of hands.slice(0, 2)) {
    if (out[h.side] === null) out[h.side] = h;
    else if (out[h.side === "left" ? "right" : "left"] === null) out[h.side === "left" ? "right" : "left"] = h;
  }
  return out;
}

function veilMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute vec2 aDisc;
      varying float vAlpha;
      varying vec2 vDisc;
      void main() { vAlpha = aAlpha; vDisc = aDisc; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform bool uDisc;
      varying float vAlpha;
      varying vec2 vDisc;
      void main() {
        float a = vAlpha;
        if (uDisc) a *= 1.0 - smoothstep(0.4, 1.0, length(vDisc));
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * uOpacity);
      }`,
    uniforms: { uOpacity: { value: 1 }, uDisc: { value: false } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
  });
  // The colour stays as it is; the alpha (how much of the picture is hidden) takes the larger, so overlaps never stack.
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.ZeroFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquationAlpha = THREE.MaxEquation;
  return m;
}

function glowMaterial(hex: number, strength: number): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      void main() { vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() { gl_FragColor = vec4(uColor * vAlpha * uOpacity, 0.0); }`,
    uniforms: { uColor: { value: raw(hex).multiplyScalar(strength) }, uOpacity: { value: 1 } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
  });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
}

function decorMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uScan;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        float tick = floor(uTime * 24.0);
        float grain = hash(gl_FragCoord.xy + tick * 17.0) - 0.5;
        float band = 1.0 - fract(uTime / 5.5);
        float d = (vUv.y - band) * 1.2;
        float scan = 0.07 * exp(-pow(d / 0.006, 2.0)) + 0.025 * exp(-pow(d / 0.06, 2.0));
        float flicker = 0.03 + 0.05 * step(0.82, hash(vec2(floor(uTime * 11.0), 3.0))) * hash(vec2(tick, 9.0));
        vec3 colour = uScan * scan + vec3(max(grain, 0.0) * 0.045);
        gl_FragColor = vec4(colour, flicker + max(-grain, 0.0) * 0.07);
      }`,
    uniforms: { uTime: { value: 0 }, uScan: { value: raw(COL.ecto) } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquationAlpha = THREE.MaxEquation;
  return m;
}

/** Throws when the WebGL renderer can't be made; the screen then shows the film alone. */
export function createBonesEngine(canvas: HTMLCanvasElement, initial: BonesSize, options: BonesEngineOptions): BonesEngine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance", stencil: false });
  renderer.setClearAlpha(0);
  renderer.autoClear = false;

  const { still } = options;
  let size = initial;
  let mirrored = true;
  let aspect = 16 / 9;
  let disposed = false;
  let time = 0;

  // The skull's camera: at the origin, down -z, the picture's own field of view; its projection is rebuilt each frame.
  const headCam = new THREE.PerspectiveCamera(XRAY_CAMERA_FOV, aspect, 1, 1000);
  headCam.matrixAutoUpdate = false;
  headCam.updateMatrixWorld(true);
  const handCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -50, 50);
  const pixelCam = new THREE.OrthographicCamera(0, 1, 0, -1, -1, 1);
  const flatCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

  const headScene = new THREE.Scene();
  const handScene = new THREE.Scene();
  const veilScene = new THREE.Scene();
  const decorScene = new THREE.Scene();

  const skull = buildSkull();
  headScene.add(skull.root);
  skull.setOpacity(0);
  const hands: Record<"left" | "right", HandModel> = { left: buildHand(), right: buildHand() };
  for (const side of SIDES) {
    handScene.add(hands[side].root);
    hands[side].setOpacity(0);
  }

  // The face's veil: a fan inside its outline and a feathered ring out past it, plus a faint line along the outline.
  const N = FACE_OVAL.length;
  const veilFaceGeo = new THREE.BufferGeometry();
  veilFaceGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array((1 + 2 * N) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  veilFaceGeo.setAttribute("aAlpha", new THREE.Float32BufferAttribute([1, ...Array.from({ length: N }, () => 0.92), ...Array.from({ length: N }, () => 0)], 1));
  veilFaceGeo.setAttribute("aDisc", new THREE.Float32BufferAttribute(new Float32Array((1 + 2 * N) * 2), 2));
  const fanIndex: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % N);
    fanIndex.push(0, a, b, a, N + a, b, b, N + a, N + b);
  }
  veilFaceGeo.setIndex(fanIndex);
  const veilFaceMat = veilMaterial();
  const veilFace = new THREE.Mesh(veilFaceGeo, veilFaceMat);
  veilFace.frustumCulled = false;
  veilScene.add(veilFace);

  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(3 * N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  outlineGeo.setAttribute("aAlpha", new THREE.Float32BufferAttribute(Array.from({ length: 3 * N }, (_, i) => (i % 3 === 1 ? 1 : 0)), 1));
  const outlineIndex: number[] = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    for (const k of [0, 1]) outlineIndex.push(3 * i + k, 3 * i + k + 1, 3 * j + k, 3 * j + k, 3 * i + k + 1, 3 * j + k + 1);
  }
  outlineGeo.setIndex(outlineIndex);
  const outlineMat = glowMaterial(COL.ghostCool, 0.16);
  const outline = new THREE.Mesh(outlineGeo, outlineMat);
  outline.frustumCulled = false;
  outline.renderOrder = 1;
  veilScene.add(outline);

  const discGeo = (count: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, () => 1), 1));
    g.setAttribute("aDisc", new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [-1, -1, 1, -1, 1, 1, -1, 1]).flat(), 2));
    const idx: number[] = [];
    for (let i = 0; i < count; i++) idx.push(4 * i, 4 * i + 1, 4 * i + 2, 4 * i, 4 * i + 2, 4 * i + 3);
    g.setIndex(idx);
    return g;
  };
  const handVeils = SIDES.map(() => {
    const g = discGeo(MAX_DISCS);
    const m = veilMaterial();
    m.uniforms.uDisc!.value = true;
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    veilScene.add(mesh);
    return { g, m, mesh };
  });

  let decor: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } | null = null;
  if (!still) {
    const mat = decorMaterial();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.frustumCulled = false;
    decorScene.add(mesh);
    decor = { mesh, mat };
  }

  const face: FaceTrack = { presence: 0, seen: false, pos: new THREE.Vector3(), quat: [0, 0, 0, 1], scale: new THREE.Vector3(1, 1, 1), jaw: 0, corr: IDENTITY_FIT, oval: [], target: null };
  const handTracks: Record<"left" | "right", HandTrack> = { left: { presence: 0, seen: false, points: [], target: null }, right: { presence: 0, seen: false, points: [], target: null } };
  let lastAt: number | null = null;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const affine = new THREE.Matrix4();

  const readFace = (f: XrayFace, a: number) => {
    m4.fromArray(f.matrix as number[]);
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    m4.decompose(pos, q, scale);
    const oval: number[] = [];
    for (const i of FACE_OVAL) {
      const p = f.points[i];
      oval.push(p?.x ?? Number.NaN, p?.y ?? Number.NaN);
    }
    return { pos, quat: [q.x, q.y, q.z, q.w] as Quat, scale, jaw: Number.isFinite(f.jaw) ? f.jaw : 0, corr: faceCorrection(f, a), oval };
  };

  const readHand = (h: XrayHand) => h.points.slice(0, 21).flatMap((p) => [p.x, p.y, p.z]);
  const finiteAll = (xs: readonly number[]) => xs.every(Number.isFinite);

  const take = (frame: XrayFrame | null) => {
    if (frame === null) {
      face.target = null;
      for (const s of SIDES) handTracks[s].target = null;
      lastAt = null;
      return;
    }
    if (frame.at === lastAt) return;
    lastAt = frame.at;
    if (Number.isFinite(frame.aspect) && frame.aspect > 0) aspect = frame.aspect;
    const f = frame.face;
    const read = f !== null && f.matrix.length === 16 && finiteAll(f.matrix) ? readFace(f, aspect) : null;
    face.target = read;
    const slots = handSlots(frame.hands);
    for (const s of SIDES) {
      const h = slots[s];
      const pts = h !== null && h.points.length >= 21 ? readHand(h) : null;
      handTracks[s].target = pts !== null && finiteAll(pts) ? pts : null;
    }
  };

  const stepFace = (dt: number) => {
    const t = face.target;
    if (t !== null && (!face.seen || face.presence === 0)) {
      // Found again after it had gone: start where it is, not where it was.
      face.pos.copy(t.pos);
      face.quat = t.quat;
      face.scale.copy(t.scale);
      face.jaw = t.jaw;
      face.corr = t.corr;
      face.oval = [...t.oval];
      face.seen = true;
    } else if (t !== null) {
      face.pos.set(approach(face.pos.x, t.pos.x, dt, POSE_HALF_LIFE), approach(face.pos.y, t.pos.y, dt, POSE_HALF_LIFE), approach(face.pos.z, t.pos.z, dt, POSE_HALF_LIFE));
      face.quat = approachQuat(face.quat, t.quat, dt, POSE_HALF_LIFE);
      face.scale.set(approach(face.scale.x, t.scale.x, dt, POSE_HALF_LIFE), approach(face.scale.y, t.scale.y, dt, POSE_HALF_LIFE), approach(face.scale.z, t.scale.z, dt, POSE_HALF_LIFE));
      face.jaw = approach(face.jaw, t.jaw, dt, POSE_HALF_LIFE);
      face.corr = { s: approach(face.corr.s, t.corr.s, dt, POSE_HALF_LIFE), tx: approach(face.corr.tx, t.corr.tx, dt, POSE_HALF_LIFE), ty: approach(face.corr.ty, t.corr.ty, dt, POSE_HALF_LIFE) };
      if (face.oval.length === t.oval.length) ease(face.oval, t.oval, dt, POINT_HALF_LIFE);
      else face.oval = [...t.oval];
    }
    face.presence = fade(face.presence, t !== null, dt);
  };

  const stepHand = (track: HandTrack, dt: number) => {
    const t = track.target;
    if (t !== null && (!track.seen || track.presence === 0 || track.points.length !== t.length)) {
      track.points = [...t];
      track.seen = true;
    } else if (t !== null) ease(track.points, t, dt, POINT_HALF_LIFE);
    track.presence = fade(track.presence, t !== null, dt);
  };

  /** Premultiplies a camera's projection by a scale and shift on device coordinates. */
  const onScreen = (cam: THREE.Camera, sx: number, sy: number, ox: number, oy: number) => {
    affine.set(sx, 0, 0, ox, 0, sy, 0, oy, 0, 0, 1, 0, 0, 0, 0, 1);
    cam.projectionMatrix.premultiply(affine);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  };

  const drawFace = (fit: ScreenFit) => {
    const k = ndcScale(fit);
    skull.setOpacity(face.presence);
    veilFaceMat.uniforms.uOpacity!.value = face.presence * VEIL_DEPTH;
    outlineMat.uniforms.uOpacity!.value = face.presence;
    if (face.presence <= 0.001) {
      veilFace.visible = false;
      outline.visible = false;
      return;
    }
    headCam.aspect = aspect;
    headCam.updateProjectionMatrix();
    const c = correctionNdc(face.corr, aspect);
    onScreen(headCam, k.x * c.sx, k.y * c.sy, k.x * c.ox, k.y * c.oy);
    m4.compose(face.pos, q.set(...face.quat), face.scale);
    skull.root.matrix.copy(m4);
    skull.root.matrixWorldNeedsUpdate = true;
    skull.setJaw(face.jaw);

    const points = Array.from({ length: Math.max(...FACE_OVAL) + 1 }, () => ({ x: Number.NaN, y: Number.NaN, z: 0 }));
    FACE_OVAL.forEach((index, i) => {
      points[index] = { x: face.oval[2 * i]!, y: face.oval[2 * i + 1]!, z: 0 };
    });
    const veil = faceVeil(points, fit);
    veilFace.visible = veil !== null;
    outline.visible = veil !== null;
    if (veil === null) return;
    const pos = veilFaceGeo.getAttribute("position") as THREE.BufferAttribute;
    pos.setXYZ(0, veil.center.x, -veil.center.y, 0);
    veil.inner.forEach((p, i) => pos.setXYZ(1 + i, p.x, -p.y, 0));
    veil.outer.forEach((p, i) => pos.setXYZ(1 + N + i, p.x, -p.y, 0));
    pos.needsUpdate = true;
    const line = outlineGeo.getAttribute("position") as THREE.BufferAttribute;
    const half = 1.6;
    veil.inner.forEach((p, i) => {
      const dx = p.x - veil.center.x;
      const dy = p.y - veil.center.y;
      const n = Math.hypot(dx, dy) || 1;
      for (const [k2, off] of [[0, -half], [1, 0], [2, half]] as const) line.setXYZ(3 * i + k2, p.x + (dx / n) * off, -(p.y + (dy / n) * off), 0);
    });
    line.needsUpdate = true;
  };

  const drawHands = (fit: ScreenFit) => {
    const k = ndcScale(fit);
    handCam.left = -aspect / 2;
    handCam.right = aspect / 2;
    handCam.top = 0.5;
    handCam.bottom = -0.5;
    handCam.updateProjectionMatrix();
    onScreen(handCam, k.x, k.y, 0, 0);
    SIDES.forEach((side, n) => {
      const track = handTracks[side];
      const model = hands[side];
      const veil = handVeils[n]!;
      model.setOpacity(track.presence);
      veil.m.uniforms.uOpacity!.value = track.presence * VEIL_DEPTH;
      veil.mesh.visible = track.presence > 0.001;
      if (track.presence <= 0.001 || track.points.length < 63) return;
      const pts = Array.from({ length: 21 }, (_, i) => ({ x: track.points[3 * i]!, y: track.points[3 * i + 1]!, z: track.points[3 * i + 2]! }));
      model.update(handRig(pts.map((p) => handSpace(p, aspect))));
      const discs = handVeil(pts, fit);
      const pos = veil.g.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < MAX_DISCS; i++) {
        const d = discs[i];
        const r = d?.r ?? 0;
        const x = d?.x ?? 0;
        const y = -(d?.y ?? 0);
        pos.setXYZ(4 * i, x - r, y - r, 0);
        pos.setXYZ(4 * i + 1, x + r, y - r, 0);
        pos.setXYZ(4 * i + 2, x + r, y + r, 0);
        pos.setXYZ(4 * i + 3, x - r, y + r, 0);
      }
      pos.needsUpdate = true;
    });
  };

  const resize = (next: BonesSize) => {
    if (disposed || next.w <= 0 || next.h <= 0) return;
    size = next;
    renderer.setPixelRatio(Math.min(next.dpr, BONES_MAX_DPR));
    renderer.setSize(next.w, next.h, false);
    pixelCam.left = 0;
    pixelCam.right = next.w;
    pixelCam.top = 0;
    pixelCam.bottom = -next.h;
    pixelCam.updateProjectionMatrix();
  };
  resize(initial);

  return {
    setMirrored(m) {
      mirrored = m;
    },
    resize,
    frame(dt, frame) {
      if (disposed) return;
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      time += step;
      take(frame);
      stepFace(step);
      for (const s of SIDES) stepHand(handTracks[s], step);
      const fit = coverFit(aspect, size.w, size.h, mirrored);
      drawFace(fit);
      drawHands(fit);
      renderer.clear();
      if (decor !== null) {
        decor.mat.uniforms.uTime!.value = time;
        renderer.render(decorScene, flatCam);
      }
      renderer.render(veilScene, pixelCam);
      if (face.presence > 0.001) renderer.render(headScene, headCam);
      if (handTracks.left.presence > 0.001 || handTracks.right.presence > 0.001) renderer.render(handScene, handCam);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      skull.dispose();
      for (const s of SIDES) hands[s].dispose();
      veilFaceGeo.dispose();
      veilFaceMat.dispose();
      outlineGeo.dispose();
      outlineMat.dispose();
      for (const v of handVeils) {
        v.g.dispose();
        v.m.dispose();
      }
      if (decor !== null) {
        decor.mesh.geometry.dispose();
        decor.mat.dispose();
      }
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
