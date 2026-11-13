// The radio globe's meshes (brief 047 part C), from primitives and a map drawn in code: no model files. A sphere of
// radius 1 wears the map; a slightly larger back-side shell adds a green rim of light; each station is a small brass
// light with a soft glow just above the surface; the tuned station is a larger green marker with a thin antenna and
// rings that spread over the surface. Built without WebGL, so the tests run in node.
// Positions follow latLonToVec (motion.ts): latitude 0, longitude 0 at +Z, north +Y, east +X. The sphere's seam is
// turned (phiStart) so that texture u = (longitude + 180) / 360 lands on the same meridian.
import * as THREE from "three";
import type { Station } from "../../../ui/radio/types";
import { C, COL } from "../../avatar/three/config";
import { MARKER_RINGS, latLonToVec } from "./motion";
import { MAP_H, MAP_W, type MapContext, type MapPalette, drawMap } from "./texture";

/** What the model needs to draw its map on: a canvas the caller makes (a real one in the browser, a fake in tests). */
export interface MapCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): MapContext | null;
}

export const GLOBE_RADIUS = 1;
export const GLOBE_SEGMENTS = { width: 64, height: 48 } as const;
/** The rim shell's radius. */
export const SHELL_RADIUS = 1.07;
/** A station light's radius and how far above the surface its centre sits, in globe radii. */
export const LIGHT_RADIUS = 0.018;
export const LIGHT_LIFT = 1.016;
/** A light's glow is this many times its radius. */
export const GLOW_FACTOR = 3;
/** A hovered light grows by this much. */
export const HOVER_SCALE = 1.45;
export const MARKER_RADIUS = 0.03;
export const ANTENNA_LENGTH = 0.13;

export interface GlobeModel {
  /** Turned by the motion: everything on the globe's surface is inside it. */
  readonly root: THREE.Group;
  readonly globe: THREE.Mesh;
  readonly shell: THREE.Mesh;
  /** One per station, in the stations' order. */
  readonly lights: readonly THREE.Mesh[];
  readonly glows: readonly THREE.Sprite[];
  /** Unit vectors in the globe's own frame, one per station. */
  readonly positions: readonly THREE.Vector3[];
  readonly marker: {
    readonly group: THREE.Group;
    readonly core: THREE.Mesh;
    readonly glow: THREE.Sprite;
    readonly antenna: THREE.Mesh;
    readonly tip: THREE.Mesh;
    readonly rings: readonly THREE.Mesh[];
  };
  readonly map: THREE.CanvasTexture;
  /** Moves the marker to station `index` (and hides its brass light), or hides it for -1. */
  setTuned(index: number): void;
  /** Grows light `index`, or none for -1. */
  setHover(index: number): void;
  dispose(): void;
}

/** A soft round glow, white at the centre and clear at the edge. */
function glowTexture(): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - (N - 1) / 2, y - (N - 1) / 2) / (N / 2);
      const a = Math.max(0, 1 - d) ** 2.2;
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const RIM_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

// The shell is drawn from behind. Its back faces point away from the viewer; d is 0 at the shell's own edge and
// largest just outside the globe's edge, so the light is brightest against the globe and fades out to nothing.
const RIM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uEdge;
uniform float uStrength;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float d = max(0.0, -dot(normalize(vNormal), normalize(vView)));
  float k = clamp(d / uEdge, 0.0, 1.0);
  float a = pow(k, 1.7) * uStrength;
  gl_FragColor = vec4(uColor * a, a);
}`;

/** The globe, built from `stations` with its map drawn on a canvas from `makeCanvas`. */
export function buildGlobe(stations: readonly Station[], makeCanvas: () => MapCanvas, palette: MapPalette): GlobeModel {
  const root = new THREE.Group();
  root.name = "radio-globe";

  const canvas = makeCanvas();
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) drawMap(ctx, MAP_W, MAP_H, palette);
  const map = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS, GLOBE_SEGMENTS.width, GLOBE_SEGMENTS.height, -Math.PI / 2),
    new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: C(COL.spark), emissiveIntensity: 0.3, roughness: 0.86, metalness: 0 }),
  );
  globe.name = "globe";
  root.add(globe);

  const edge = Math.sqrt(1 - (GLOBE_RADIUS / SHELL_RADIUS) ** 2);
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(SHELL_RADIUS, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: C(COL.ecto) }, uEdge: { value: edge }, uStrength: { value: 0.9 } },
      vertexShader: RIM_VERTEX,
      fragmentShader: RIM_FRAGMENT,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  shell.name = "rim";
  root.add(shell);

  const glowTex = glowTexture();
  const lightGeo = new THREE.SphereGeometry(LIGHT_RADIUS, 12, 8);
  const lightMat = new THREE.MeshBasicMaterial({ color: C(COL.gold) });
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: C(COL.brass), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  const positions: THREE.Vector3[] = [];
  const lights: THREE.Mesh[] = [];
  const glows: THREE.Sprite[] = [];
  for (const s of stations) {
    const p = new THREE.Vector3(...latLonToVec(s.lat, s.lon));
    positions.push(p);
    const light = new THREE.Mesh(lightGeo, lightMat);
    light.position.copy(p).multiplyScalar(LIGHT_LIFT);
    light.userData.stationId = s.id;
    const glow = new THREE.Sprite(glowMat);
    glow.position.copy(light.position);
    glow.scale.setScalar(LIGHT_RADIUS * GLOW_FACTOR * 2);
    glow.renderOrder = 2;
    root.add(light, glow);
    lights.push(light);
    glows.push(glow);
  }

  // The marker: its local +Z is the surface's outward normal, so the antenna points up and the rings lie flat.
  const group = new THREE.Group();
  group.name = "tuned";
  group.visible = false;
  const core = new THREE.Mesh(new THREE.SphereGeometry(MARKER_RADIUS, 16, 12), new THREE.MeshBasicMaterial({ color: C(COL.ecto) }));
  core.position.z = 0.014;
  const markerGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C(COL.ecto), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  markerGlow.position.z = 0.016;
  markerGlow.scale.setScalar(MARKER_RADIUS * GLOW_FACTOR * 2.2);
  markerGlow.renderOrder = 3;
  const antennaGeo = new THREE.CylinderGeometry(0.0016, 0.0042, ANTENNA_LENGTH, 6);
  antennaGeo.rotateX(Math.PI / 2);
  const antenna = new THREE.Mesh(antennaGeo, new THREE.MeshBasicMaterial({ color: C(COL.ecto) }));
  antenna.position.z = 0.014 + ANTENNA_LENGTH / 2;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 10, 8), new THREE.MeshBasicMaterial({ color: C(COL.spark) }));
  tip.position.z = 0.014 + ANTENNA_LENGTH;
  const ringGeo = new THREE.RingGeometry(0.9, 1, 64);
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < MARKER_RINGS; i++) {
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: C(COL.ecto), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    ring.position.z = 0.006;
    ring.renderOrder = 4;
    rings.push(ring);
  }
  group.add(core, markerGlow, antenna, tip, ...rings);
  root.add(group);

  const zAxis = new THREE.Vector3(0, 0, 1);
  let tuned = -1;
  let hovered = -1;
  const scaleLight = (i: number) => {
    const k = i === hovered && i !== tuned ? HOVER_SCALE : 1;
    lights[i]!.scale.setScalar(k);
    glows[i]!.scale.setScalar(LIGHT_RADIUS * GLOW_FACTOR * 2 * k);
  };

  let disposed = false;
  return {
    root,
    globe,
    shell,
    lights,
    glows,
    positions,
    marker: { group, core, glow: markerGlow, antenna, tip, rings },
    map,
    setTuned(index) {
      const next = index >= 0 && index < lights.length ? index : -1;
      if (tuned >= 0) {
        lights[tuned]!.visible = true;
        glows[tuned]!.visible = true;
      }
      const was = tuned;
      tuned = next;
      if (was >= 0) scaleLight(was);
      if (next < 0) {
        group.visible = false;
        return;
      }
      lights[next]!.visible = false;
      glows[next]!.visible = false;
      group.position.copy(positions[next]!);
      group.quaternion.setFromUnitVectors(zAxis, positions[next]!);
      group.visible = true;
    },
    setHover(index) {
      const next = index >= 0 && index < lights.length ? index : -1;
      const was = hovered;
      hovered = next;
      if (was >= 0) scaleLight(was);
      if (next >= 0) scaleLight(next);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      root.traverse((o) => {
        const m = o as THREE.Mesh | THREE.Sprite;
        if ((m as THREE.Mesh).isMesh) geos.add((m as THREE.Mesh).geometry);
        if ((m as THREE.Mesh).isMesh || (m as THREE.Sprite).isSprite) mats.add(m.material as THREE.Material);
      });
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      map.dispose();
      glowTex.dispose();
    },
  };
}
