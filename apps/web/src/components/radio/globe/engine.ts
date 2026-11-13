// The radio globe's own small three.js scene (brief 047 part C), on a square canvas with a clear background inside
// the radio panel. Same renderer discipline as the wall phone's: alpha with clear alpha 0, a device-pixel cap, and on
// dispose every geometry, material and texture freed and the context lost at once. The engine lives while the panel
// is open and the globe can be drawn.
// Picking projects the near-side stations to CSS pixels and takes the nearest within PICK_RADIUS: no raycast against
// tiny spheres, so a fingertip finds a light as easily as a mouse does.
import * as THREE from "three";
import type { RadioSignal, Station } from "../../../ui/radio/types";
import { C, COL } from "../../avatar/three/config";
import { type GlobeModel, type MapCanvas, buildGlobe } from "./model";
import { type GlobeMotion, INITIAL_GLOBE, dragBy, faceStation, markerLook, release, stepGlobe } from "./motion";
import type { MapPalette } from "./texture";

export interface GlobeSize {
  /** CSS pixels. */
  w: number;
  h: number;
  dpr: number;
}

export interface GlobeView {
  readonly tunedId: string | null;
  readonly signal: RadioSignal;
}

export interface GlobeEngineOptions {
  readonly stations: readonly Station[];
  /** Reduced_Motion: no spin, no coast, a tune jumps, and the marker is drawn in its settled look. */
  readonly still: boolean;
  /** The map's colours, read from the CSS tokens by the wrapper. */
  readonly palette: MapPalette;
  /** Makes the canvas the map is drawn on. The browser's document by default. */
  readonly makeCanvas?: () => MapCanvas;
}

export interface ProjectedStation {
  /** CSS pixels from the canvas's top left. */
  readonly x: number;
  readonly y: number;
  /** False when the station is on the far side of the globe. */
  readonly visible: boolean;
}

export interface GlobeEngine {
  setView(view: GlobeView): void;
  setHover(id: string | null): void;
  /** A held pointer moved by (dx, dy) CSS pixels. */
  dragBy(dx: number, dy: number): void;
  /** The pointer let go, moving at (vx, vy) CSS pixels a second. */
  release(vx: number, vy: number): void;
  /** The station whose light is nearest (x, y), on the near side, within PICK_RADIUS; or null. */
  pick(x: number, y: number): string | null;
  project(id: string): ProjectedStation | null;
  resize(size: GlobeSize): void;
  /** Advances the motion by `dt` seconds and draws one frame. A still engine draws without moving. */
  frame(dt: number): void;
  dispose(): void;
}

/** The most device pixels drawn per CSS pixel. */
export const GLOBE_MAX_DPR = 2;
/** How near a press must land to a light to pick it, CSS pixels. */
export const PICK_RADIUS = 28;
/** The share of the canvas's height the globe fills. */
export const GLOBE_FILL = 0.82;
const CAM_FOV = 30;
/** The camera distance at which a unit sphere fills GLOBE_FILL of the view's height. */
export const CAM_DIST = Math.sqrt(1 + (1 / (GLOBE_FILL * Math.tan(THREE.MathUtils.degToRad(CAM_FOV / 2)))) ** 2);
/** A light this close to the limb (the cosine between its normal and the view) counts as out of sight. */
const NEAR_SIDE = 0.12;

/** Throws when the WebGL renderer can't be made; the caller then shows the station list instead. */
export function createGlobeEngine(canvas: HTMLCanvasElement, initial: GlobeSize, options: GlobeEngineOptions): GlobeEngine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power", stencil: false });
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.5, 20);
  camera.position.set(0, 0, CAM_DIST);
  camera.lookAt(0, 0, 0);

  // A soft key from the upper left in front, so the far limb falls into shade; a little sky and floor fill.
  const key = new THREE.DirectionalLight(C(COL.spark), 2.2);
  key.position.set(-2.4, 1.8, 3.2);
  const hemi = new THREE.HemisphereLight(C(COL.ghostCool), C(COL.night0), 0.35);
  scene.add(key, hemi);

  const makeCanvas = options.makeCanvas ?? (() => document.createElement("canvas") as unknown as MapCanvas);
  const { stations, still } = options;
  const model: GlobeModel = buildGlobe(stations, makeCanvas, options.palette);
  model.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  scene.add(model.root);

  const indexOf = new Map(stations.map((s, i) => [s.id, i] as const));
  const ringMats = model.marker.rings.map((r) => r.material as THREE.MeshBasicMaterial);
  const coreMat = model.marker.core.material as THREE.MeshBasicMaterial;
  const antennaMat = model.marker.antenna.material as THREE.MeshBasicMaterial;
  const markerGlowMat = model.marker.glow.material as THREE.SpriteMaterial;
  const tone = { live: C(COL.ecto), tuning: C(COL.brassHi), waiting: C(COL.brass), ember: C(COL.arcEdge) } as const;

  let motion: GlobeMotion = INITIAL_GLOBE;
  let view: GlobeView = { tunedId: null, signal: "silent" };
  let markerT = 0;
  let size: GlobeSize = initial;
  let disposed = false;

  const world = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const normal = new THREE.Vector3();

  const pose = () => {
    model.root.rotation.set(motion.pitch, motion.yaw, 0, "XYZ");
    model.root.updateMatrixWorld(true);
    const i = view.tunedId === null ? -1 : (indexOf.get(view.tunedId) ?? -1);
    if (i < 0) return;
    const look = markerLook(view.signal, markerT, still);
    const col = tone[look.tone];
    coreMat.color.copy(col).multiplyScalar(0.55 + 0.75 * look.level);
    antennaMat.color.copy(col);
    markerGlowMat.color.copy(col);
    markerGlowMat.opacity = 0.35 + 0.6 * look.level;
    look.rings.forEach((r, k) => {
      model.marker.rings[k]!.scale.setScalar(r.radius);
      ringMats[k]!.opacity = r.opacity;
      model.marker.rings[k]!.visible = r.opacity > 0.002;
    });
  };

  const projectIndex = (i: number): ProjectedStation => {
    world.copy(model.positions[i]!).applyMatrix4(model.root.matrixWorld);
    toCam.copy(camera.position).sub(world).normalize();
    const facing = normal.copy(world).normalize().dot(toCam);
    ndc.copy(world).project(camera);
    return { x: ((ndc.x + 1) / 2) * size.w, y: ((1 - ndc.y) / 2) * size.h, visible: facing > NEAR_SIDE };
  };

  const resize = (next: GlobeSize) => {
    if (disposed || next.w <= 0 || next.h <= 0) return;
    size = next;
    renderer.setPixelRatio(Math.min(next.dpr, GLOBE_MAX_DPR));
    renderer.setSize(next.w, next.h, false);
    camera.aspect = next.w / next.h;
    // A canvas wider than tall keeps the globe's height; a taller one keeps its width.
    camera.fov = next.w >= next.h ? CAM_FOV : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(CAM_FOV / 2)) / camera.aspect));
    camera.updateProjectionMatrix();
  };
  resize(initial);
  pose();

  return {
    setView(next) {
      if (disposed) return;
      const tunedChanged = next.tunedId !== view.tunedId;
      if (tunedChanged || next.signal !== view.signal) markerT = 0;
      view = next;
      if (!tunedChanged) return;
      const i = next.tunedId === null ? -1 : (indexOf.get(next.tunedId) ?? -1);
      model.setTuned(i);
      if (i >= 0) motion = faceStation(motion, stations[i]!.lat, stations[i]!.lon, { still });
    },
    setHover(id) {
      if (disposed) return;
      model.setHover(id === null ? -1 : (indexOf.get(id) ?? -1));
    },
    dragBy(dx, dy) {
      if (disposed) return;
      motion = dragBy(motion, dx, dy, size.w);
    },
    release(vx, vy) {
      if (disposed) return;
      motion = release(motion, vx, vy, size.w, { still });
    },
    pick(x, y) {
      if (disposed) return null;
      pose();
      let best: string | null = null;
      let bestD = PICK_RADIUS;
      for (let i = 0; i < stations.length; i++) {
        const p = projectIndex(i);
        if (!p.visible) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= bestD) {
          bestD = d;
          best = stations[i]!.id;
        }
      }
      return best;
    },
    project(id) {
      const i = indexOf.get(id);
      if (disposed || i === undefined) return null;
      return projectIndex(i);
    },
    resize,
    frame(dt) {
      if (disposed) return;
      if (!still) {
        motion = stepGlobe(motion, dt, { idleSpin: view.tunedId === null, still });
        markerT += Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;
      }
      pose();
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      model.dispose();
      renderer.dispose();
      // The canvas goes with the panel, so its context is freed now and not at the next collection.
      renderer.forceContextLoss();
    },
  };
}
