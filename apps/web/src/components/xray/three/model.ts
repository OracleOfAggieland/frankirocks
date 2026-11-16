// The X-ray machine, built from three.js primitives with no model files: an antique fluoroscope from Franki's lab, in
// the wall phone's and the radio's oak and brass, so the three read as one lab's things. A standing oak cabinet on a
// walnut plinth with four feet and a walnut crown; a dark glass viewing screen in a brass bezel with eight rivets; on
// the glass, when it is lit, a code-drawn picture of a hand's bones (a ring on one finger shows as solid metal, as
// metal does on film) with a scan line passing over it; under the glass one dial with a needle, three vent slots and
// a brass knob; a row of dark stitches down the front's right edge, because Franki is stitched together and so are
// his things; a glass valve on the top whose filament glows; and on the top's right a brass turret with a jointed
// arm (twin rods and a spring, brass knuckles) that holds the tube head: a brass housing with a cone and a glowing
// window at its front, aimed at the glass, and two electrodes on its back that an arc crackles between while the
// tube warms. A faint beam runs from the window to the glass while it looks for bones. Colours come from the ghost's
// own palette. Units: the cabinet is 0.72 wide and stands on y = 0.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { C, COL } from "../../avatar/three/config";
import { mulberry32 } from "../../avatar/three/math";

/** The cabinet: its half width, where it starts above the plinth, its top and its depth. */
export const CAB = { halfW: 0.36, bottom: 0.1, top: 1.0, depth: 0.38 } as const;
/** The cabinet's front face, in the machine's own space. */
export const FRONT_Z = CAB.depth / 2;
/** The top of the crown, where the valve and the arm's turret stand. */
export const TOP_Y = CAB.top + 0.045;

/** The viewing glass: its middle and its size. The bezel is BEZEL wider on every side. */
export const SCREEN = { x: 0, y: 0.63, w: 0.4, h: 0.44 } as const;
export const BEZEL = 0.05;
const BEZEL_DEPTH = 0.025;
/** The dial under the glass, on the left; the knob on the right; the vents between them. */
export const DIAL = { x: -0.19, y: 0.22, r: 0.07 } as const;
export const KNOB = { x: 0.19, y: 0.22 } as const;
/** The needle's swing either side of upright, in radians. */
export const NEEDLE_SWING = 0.95;
/** The valve on the top's left. */
export const VALVE = { x: -0.2, z: 0 } as const;

/** Where the arm leaves the turret on the top's right, in the machine's own space. */
export const SHOULDER = new THREE.Vector3(0.22, TOP_Y + 0.08, -0.05);
/**
 * The arm: two links in one upright plane, turned ARM.yaw about the vertical from the machine's front, so the arm
 * reaches out to the right and a little forward and shows its side to the camera. Angles lean each link forward
 * from straight up: `shoulder` for the upper link, `elbow` for the forearm against the upper link.
 */
export const ARM = {
  upper: 0.36,
  fore: 0.42,
  yaw: 0.9,
  parked: { shoulder: 0.1, elbow: 1.35 },
  aimed: { shoulder: 0.55, elbow: 1.75 },
} as const;

/** The arm's two angles at pose `aim` (0 parked, 1 aimed at the glass). */
export function armAngles(aim: number): { shoulder: number; elbow: number } {
  const a = aim < 0 ? 0 : aim > 1 ? 1 : aim;
  return {
    shoulder: ARM.parked.shoulder + (ARM.aimed.shoulder - ARM.parked.shoulder) * a,
    elbow: ARM.parked.elbow + (ARM.aimed.elbow - ARM.parked.elbow) * a,
  };
}

/** The tube head, in its own space, looking down +z: the housing, the window at its front and the two electrodes. */
export const HEAD = { r: 0.068, len: 0.16, coneLen: 0.08, window: 0.032 } as const;
export const APERTURE_Z = HEAD.len / 2 + HEAD.coneLen + 0.002;
export const TERMINAL = { x: 0.045, y: 0.13, z: -0.035 } as const;
/** The arc: bolts of a few segments each, leaping between the two electrodes. */
export const ARC_BOLTS = 2;
export const ARC_SEGMENTS = 4;

/** The film's size in texels: a little taller than wide, as the glass is. */
export const FILM_W = 128;
export const FILM_H = 144;

export interface XrayModel {
  /** Everything that stands on the floor; the engine turns this. */
  root: THREE.Group;
  /** The glass behind the picture, whose emissive glow is the machine's main light. */
  glass: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** The hand's bones, drawn over the glass. */
  bones: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** The scan line on the glass. */
  scanLine: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** The soft light the glass throws in front of it. */
  screenGlow: THREE.Sprite;
  dialFace: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** The needle's pivot; the needle stands up from it. */
  needle: THREE.Group;
  knob: THREE.Group;
  filament: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  valveGlow: THREE.Sprite;
  /** The arm's joints: the shoulder turns the upper link, the elbow the forearm, and the head hangs at its end. */
  shoulder: THREE.Group;
  elbow: THREE.Group;
  head: THREE.Group;
  /** The window at the head's front, and its glow. */
  aperture: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  apertureGlow: THREE.Sprite;
  /** The arc's segments, ARC_BOLTS × ARC_SEGMENTS thin boxes, children of the arc's group on the head. */
  arcs: THREE.Mesh[];
  arcGroup: THREE.Group;
  arcGlow: THREE.Sprite;
  /** The faint beam from the head's window to the glass: narrow at y = 0, wide at y = 1, in the root's space. */
  beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  shadow: THREE.Sprite;
  dispose(): void;
}

/** Vertical wood grain as a small greyscale texture, as on the phone and the radio. */
function grainTexture(seed: number): THREE.DataTexture {
  const W = 64, H = 128;
  const rnd = mulberry32(seed);
  const streak = Array.from({ length: W }, () => rnd());
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const wander = 2.5 * Math.sin(y * 0.09 + seed) + 1.2 * Math.sin(y * 0.26 + seed * 2);
    for (let x = 0; x < W; x++) {
      const u = x + wander;
      const i0 = ((Math.floor(u) % W) + W) % W, i1 = (i0 + 1) % W, f = u - Math.floor(u);
      const s = streak[i0]! * (1 - f) + streak[i1]! * f;
      const v = Math.round(255 * (0.68 + 0.32 * s - 0.05 * rnd()));
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, W, H, { srgb: true, repeat: true, mips: true });
}

function dataTexture(data: Uint8Array, w: number, h: number, o: { srgb?: boolean; repeat?: boolean; mips?: boolean } = {}): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  if (o.srgb === true) tex.colorSpace = THREE.SRGBColorSpace;
  if (o.repeat === true) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = o.mips === true ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = o.mips === true;
  tex.needsUpdate = true;
  return tex;
}

/** A greyscale texture from a function of (u, v), both 0 to 1, v from the top. */
function greyTexture(w: number, h: number, f: (u: number, v: number) => number, mips = false): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // DataTexture rows run from the bottom, so the top row of the picture is written last.
      const v = Math.round(255 * Math.min(1, Math.max(0, f((x + 0.5) / w, (y + 0.5) / h))));
      const i = ((h - 1 - y) * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, w, h, { mips });
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
  return dataTexture(data, N, N);
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Distance from (px, py) to the segment a-b, and how far along it the nearest point is (0 to 1). */
function segment(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const h = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return [Math.hypot(px - ax - dx * h, py - ay - dy * h), h];
}

/** One bone on the film: a shaft from a to b of radius r, with a knuckle at each end a little wider. */
interface Bone {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly r: number;
}

/**
 * A hand's bones on the film, palm on, fingers up and the thumb to the left, in film units (x 0 to 1 left to right,
 * y 0 to 1 top to bottom). Drawn from general anatomy, not from any data set: two forearm bones, the wrist's small
 * bones, five long hand bones and the finger bones, three to a finger and two to the thumb.
 */
export function handBones(): { bones: Bone[]; carpals: { x: number; y: number; r: number }[]; ring: Bone } {
  const bones: Bone[] = [
    { ax: 0.4, ay: 1.06, bx: 0.42, by: 0.8, r: 0.034 },
    { ax: 0.62, ay: 1.06, bx: 0.6, by: 0.81, r: 0.027 },
  ];
  const carpals = [
    { x: 0.42, y: 0.765, r: 0.03 },
    { x: 0.5, y: 0.76, r: 0.029 },
    { x: 0.58, y: 0.765, r: 0.028 },
    { x: 0.385, y: 0.715, r: 0.027 },
    { x: 0.455, y: 0.7, r: 0.028 },
    { x: 0.53, y: 0.695, r: 0.028 },
    { x: 0.6, y: 0.71, r: 0.026 },
  ];
  // Each ray: the long hand bone's base and head, its radius, and the finger bones' lengths beyond it.
  const rays: { base: [number, number]; head: [number, number]; r: number; lengths: number[] }[] = [
    { base: [0.355, 0.685], head: [0.245, 0.575], r: 0.024, lengths: [0.11, 0.08] },
    { base: [0.43, 0.655], head: [0.395, 0.44], r: 0.021, lengths: [0.135, 0.082, 0.06] },
    { base: [0.505, 0.65], head: [0.505, 0.425], r: 0.022, lengths: [0.148, 0.09, 0.063] },
    { base: [0.575, 0.66], head: [0.61, 0.45], r: 0.02, lengths: [0.135, 0.085, 0.06] },
    { base: [0.64, 0.68], head: [0.705, 0.505], r: 0.018, lengths: [0.105, 0.065, 0.052] },
  ];
  const GAP = 0.018;
  let ring: Bone = { ax: 0, ay: 0, bx: 0, by: 0, r: 0 };
  rays.forEach((ray, k) => {
    const [ax, ay] = ray.base, [bx, by] = ray.head;
    bones.push({ ax, ay, bx, by, r: ray.r });
    // Each finger fans out a little more with each bone, away from the middle finger.
    const fan = (k - 2) * 0.05;
    let dir = Math.atan2(by - ay, bx - ax);
    let x = bx, y = by;
    ray.lengths.forEach((l, j) => {
      dir += fan;
      const sx = x + Math.cos(dir) * GAP, sy = y + Math.sin(dir) * GAP;
      const ex = sx + Math.cos(dir) * l, ey = sy + Math.sin(dir) * l;
      const r = ray.r * (j === 0 ? 0.86 : j === 1 ? 0.74 : 0.64);
      bones.push({ ax: sx, ay: sy, bx: ex, by: ey, r });
      // A ring on the fourth finger's first bone, across it.
      if (k === 3 && j === 0) {
        const mx = (sx + ex) / 2, my = (sy + ey) / 2, nx = -Math.sin(dir), ny = Math.cos(dir), w = r * 1.55;
        ring = { ax: mx - nx * w, ay: my - ny * w, bx: mx + nx * w, by: my + ny * w, r: 0.0085 };
      }
      x = ex;
      y = ey;
    });
  });
  return { bones, carpals, ring };
}

/**
 * The film's brightness at (u, v), 0 to 1: dark where there is nothing, a faint grey for the hand's flesh with a
 * slightly brighter skin line, the bones bright with brighter edges (as the hard outer bone shows on film) and the
 * ring solid and brightest. Pure, so the picture can be checked in node.
 */
export function handFilm(): (u: number, v: number) => number {
  const { bones, carpals, ring } = handBones();
  const aspect = FILM_W / FILM_H;
  return (u: number, v: number) => {
    // Film units are square on the glass: x is scaled by the film's aspect.
    const px = u * aspect + (1 - aspect) / 2, py = v;
    let bone = Infinity, flesh = Infinity;
    for (const b of bones) {
      const [d, h] = segment(px, py, b.ax, b.ay, b.bx, b.by);
      // The shaft narrows a little in the middle; the ends swell into knuckles.
      const knuckle = 1 + 0.28 * Math.max(0, 1 - Math.min(h, 1 - h) * 6);
      bone = Math.min(bone, d - b.r * knuckle * (0.9 + 0.1 * Math.abs(2 * h - 1)));
      flesh = Math.min(flesh, d - b.r - 0.045);
    }
    for (const c of carpals) {
      const d = Math.hypot(px - c.x, py - c.y);
      bone = Math.min(bone, d - c.r);
      flesh = Math.min(flesh, d - c.r - 0.06);
    }
    // The palm and the forearm fill in between the bones.
    flesh = Math.min(flesh, segment(px, py, 0.5, 1.1, 0.5, 0.74)[0] - 0.135, segment(px, py, 0.43, 0.62, 0.62, 0.62)[0] - 0.1);
    const fleshIn = smooth(0.012, -0.012, flesh);
    const skin = 0.05 * Math.exp(-((flesh / 0.008) ** 2));
    let value = 0.15 * fleshIn + skin;
    if (bone < 0.012) {
      const cover = smooth(0.004, -0.004, bone);
      const edge = Math.exp(-(((bone + 0.006) / 0.006) ** 2));
      value = Math.max(value, cover * (0.6 + 0.4 * edge), 0.22 * Math.exp(-Math.max(0, bone) / 0.006));
    }
    const [dr] = segment(px, py, ring.ax, ring.ay, ring.bx, ring.by);
    value = Math.max(value, smooth(0.004, -0.002, dr - ring.r));
    return value;
  };
}

/** The glass's own glow: brightest in the middle, falling toward its rounded corners, as a fluorescent screen's does. */
const vignette = (u: number, v: number) => {
  const dx = Math.max(0, Math.abs(u - 0.5) * 2 - 0.35) / 0.65, dy = Math.max(0, Math.abs(v - 0.5) * 2 - 0.35) / 0.65;
  return 1 - 0.65 * Math.min(1, Math.hypot(dx, dy)) ** 1.6;
};

/** A rounded rectangle centred on (0, 0). */
function roundedRect(path: THREE.Path, w: number, h: number, r: number): void {
  const x = -w / 2, y = -h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

/** A helix along +y, for the arm's spring. */
class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly radius: number, private readonly length: number, private readonly turns: number) {
    super();
  }
  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.radius, t * this.length, Math.sin(a) * this.radius);
  }
}

export function buildXray(): XrayModel {
  const grainA = grainTexture(17), grainB = grainTexture(43);
  const glow = glowTexture();
  const film = greyTexture(FILM_W, FILM_H, handFilm(), true);
  const glassGlow = greyTexture(48, 48, vignette);
  // The scan line: a bright thin core with a soft tail above it, as a line that has just passed leaves.
  const scanTex = greyTexture(4, 32, (_u, v) => Math.exp(-(((v - 0.62) / 0.06) ** 2)) + 0.35 * Math.exp(-(((v - 0.4) / 0.22) ** 2)) * (v < 0.62 ? 1 : 0));
  // The beam fades from its source to the glass, and a little at the very start.
  const beamTex = greyTexture(4, 32, (_u, v) => (1 - v) ** 1.4 * smooth(1, 0.9, v) + 0.12);

  // Exactly the phone's and the radio's woods and metals, so the props are one set.
  const oak = C(COL.scarCut).lerp(C(COL.brass), 0.2);
  const walnut = C(COL.scarCut).lerp(C(COL.lamp), 0.35).lerp(C(COL.brass), 0.12);
  const woodFront = new THREE.MeshPhysicalMaterial({ color: oak, map: grainA, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.28 });
  const woodBase = new THREE.MeshPhysicalMaterial({ color: walnut, map: grainB, roughness: 0.58, clearcoat: 0.4, clearcoatRoughness: 0.35 });
  const brass = new THREE.MeshStandardMaterial({ color: C(COL.brassBase), metalness: 1, roughness: 0.26 });
  const brassWorn = new THREE.MeshStandardMaterial({ color: C(COL.brass), metalness: 1, roughness: 0.42 });
  const brassDark = new THREE.MeshStandardMaterial({ color: C(COL.brassShadow), metalness: 1, roughness: 0.38 });
  const hollow = new THREE.MeshStandardMaterial({ color: C(COL.bead), roughness: 0.9 });
  const stitchMat = new THREE.MeshStandardMaterial({ color: C(COL.hairRoot), roughness: 0.7 });
  const needleMat = new THREE.MeshBasicMaterial({ color: C(COL.scarGroove), toneMapped: false });
  const tickMat = new THREE.MeshBasicMaterial({ color: C(COL.scarCut), toneMapped: false });
  const faceMat = new THREE.MeshStandardMaterial({ color: C(COL.mote).lerp(C(COL.lamp), 0.55), roughness: 0.6, emissive: C(COL.arcOuter), emissiveIntensity: 0 });
  // The glass: nearly black with a cold green cast, a little glossy. The engine drives its emissive colour and strength.
  const glassMat = new THREE.MeshStandardMaterial({
    color: C(COL.night1).lerp(C(COL.hole), 0.12),
    roughness: 0.32,
    metalness: 0,
    emissive: C(COL.ecto),
    emissiveMap: glassGlow,
    emissiveIntensity: 0,
  });
  const add = <T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T => {
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const glowing = (map: THREE.Texture, col: number) =>
    new THREE.MeshBasicMaterial({ map, color: C(col), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const bonesMat = glowing(film, COL.catch2);
  const scanMat = glowing(scanTex, COL.catch2);
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, color: C(COL.ecto), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  // A clear cover over the picture, only there to catch the studio's highlights, so the glass reads as glass.
  const coverMat = new THREE.MeshPhysicalMaterial({ color: C(COL.ghostCool), roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false });
  const envelopeMat = new THREE.MeshPhysicalMaterial({ color: C(COL.ghostCool), roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.28, depthWrite: false });
  const filamentMat = new THREE.MeshBasicMaterial({ color: C(COL.arcOuter), toneMapped: false });
  const apertureMat = new THREE.MeshBasicMaterial({ color: C(COL.ecto), toneMapped: false });
  const arcMat = new THREE.MeshBasicMaterial({ color: C(COL.spark), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const sprite = (col: number, blending: THREE.Blending = THREE.AdditiveBlending) =>
    new THREE.SpriteMaterial({ map: glow, color: C(col), transparent: true, opacity: 0, depthWrite: false, blending });

  const root = new THREE.Group();
  const box = (w: number, h: number, d: number, r: number, mat: THREE.Material) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
  /** A cylinder whose axis points out of the machine's face. */
  const disc = (r: number, depth: number, mat: THREE.Material, seg = 32) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, seg), mat);
    m.rotation.x = Math.PI / 2;
    return m;
  };
  const ball = (r: number, mat: THREE.Material) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);

  // The cabinet: an upright oak box on a walnut plinth with four feet, and a walnut crown.
  const cabH = CAB.top - CAB.bottom;
  const cabGeo = new RoundedBoxGeometry(CAB.halfW * 2, cabH, CAB.depth, 4, 0.03);
  // Stretch the grain so it runs up the front.
  const uv = cabGeo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.2, uv.getY(i) * 1.6);
  add(root, new THREE.Mesh(cabGeo, woodFront), 0, CAB.bottom + cabH / 2, 0);
  add(root, box(CAB.halfW * 2 + 0.14, 0.08, CAB.depth + 0.12, 0.025, woodBase), 0, 0.07, 0);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.06, 16), woodBase), sx * (CAB.halfW + 0.02), 0.03, sz * (CAB.depth / 2 + 0.02));
  }
  add(root, box(CAB.halfW * 2 + 0.08, 0.05, CAB.depth + 0.06, 0.018, woodBase), 0, TOP_Y - 0.025, 0);

  // The viewing glass, set a little back in its brass bezel, with the picture, the scan line and the cover over it.
  const bezelShape = new THREE.Shape();
  roundedRect(bezelShape, SCREEN.w + BEZEL * 2, SCREEN.h + BEZEL * 2, 0.045);
  const inner = new THREE.Path();
  roundedRect(inner, SCREEN.w, SCREEN.h, 0.025);
  bezelShape.holes.push(inner);
  const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, { depth: BEZEL_DEPTH, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 8 });
  add(root, new THREE.Mesh(bezelGeo, brass), SCREEN.x, SCREEN.y, FRONT_Z);
  // A dark well behind the glass, so the bezel's inside edge has depth.
  add(root, box(SCREEN.w + 0.02, SCREEN.h + 0.02, 0.02, 0.008, hollow), SCREEN.x, SCREEN.y, FRONT_Z - 0.005);
  const glass = add(root, new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w + 0.01, SCREEN.h + 0.01), glassMat), SCREEN.x, SCREEN.y, FRONT_Z + 0.007);
  const bones = add(root, new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w * 0.94, SCREEN.h * 0.94), bonesMat), SCREEN.x, SCREEN.y, FRONT_Z + 0.009);
  bones.renderOrder = 2;
  const scanLine = add(root, new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h * 0.16), scanMat), SCREEN.x, SCREEN.y, FRONT_Z + 0.011);
  scanLine.renderOrder = 3;
  const cover = add(root, new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w + 0.01, SCREEN.h + 0.01), coverMat), SCREEN.x, SCREEN.y, FRONT_Z + 0.014);
  cover.renderOrder = 4;
  const screenGlow = add(root, new THREE.Sprite(sprite(COL.ecto)), SCREEN.x, SCREEN.y, FRONT_Z + 0.09);
  screenGlow.scale.set(SCREEN.w * 1.9, SCREEN.h * 1.7, 1);
  screenGlow.renderOrder = 5;
  // Eight rivets round the bezel: its corners and the middle of each side.
  const rx = SCREEN.w / 2 + BEZEL / 2, ry = SCREEN.h / 2 + BEZEL / 2;
  for (const [x, y] of [[-rx, -ry], [0, -ry], [rx, -ry], [rx, 0], [rx, ry], [0, ry], [-rx, ry], [-rx, 0]] as const) {
    add(root, ball(0.011, brassWorn), SCREEN.x + x, SCREEN.y + y, FRONT_Z + BEZEL_DEPTH + 0.008);
  }

  // The dial: a brass ring, a pale face that lights from inside, ticks round its top and a needle on a pivot.
  add(root, new THREE.Mesh(new THREE.TorusGeometry(DIAL.r, 0.012, 12, 40), brass), DIAL.x, DIAL.y, FRONT_Z + 0.006);
  const dialFace = add(root, new THREE.Mesh(new THREE.CircleGeometry(DIAL.r - 0.004, 32), faceMat), DIAL.x, DIAL.y, FRONT_Z + 0.004);
  const pivotY = DIAL.y - DIAL.r * 0.45;
  const TICKS = 7;
  for (let i = 0; i < TICKS; i++) {
    const a = NEEDLE_SWING - (2 * NEEDLE_SWING * i) / (TICKS - 1);
    const long = i % 3 === 0;
    const tick = add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.006, long ? 0.022 : 0.014), tickMat), DIAL.x - Math.sin(a) * 0.085, pivotY + Math.cos(a) * 0.085, FRONT_Z + 0.006);
    tick.rotation.z = a;
  }
  const needle = add(root, new THREE.Group(), DIAL.x, pivotY, FRONT_Z + 0.008);
  const needleGeo = new THREE.PlaneGeometry(0.007, 0.08);
  needleGeo.translate(0, 0.04, 0);
  needle.add(new THREE.Mesh(needleGeo, needleMat));
  add(root, disc(0.01, 0.01, brassDark, 12), DIAL.x, pivotY, FRONT_Z + 0.01);

  // The knob, with a dark mark so a turn shows.
  const knob = add(root, new THREE.Group(), KNOB.x, KNOB.y, FRONT_Z);
  const knobBody = disc(0.05, 0.05, brass, 28);
  knobBody.position.z = 0.02;
  const knobFace = disc(0.041, 0.012, brassWorn, 28);
  knobFace.position.z = 0.048;
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.036, 0.008), stitchMat);
  mark.position.set(0, 0.02, 0.056);
  knob.add(knobBody, knobFace, mark);

  // Three vent slots between the dial and the knob.
  for (const dy of [-0.045, 0, 0.045]) add(root, box(0.13, 0.016, 0.012, 0.006, hollow), 0, DIAL.y + dy, FRONT_Z - 0.002);

  // Stitches down the front's right edge: a seam line and short crossing stitches, the radio's mirror image.
  const seamX = CAB.halfW - 0.045;
  const seamTop = CAB.top - 0.06, seamBottom = CAB.bottom + 0.06;
  add(root, new THREE.Mesh(new THREE.BoxGeometry(0.006, seamTop - seamBottom, 0.006), stitchMat), seamX, (seamTop + seamBottom) / 2, FRONT_Z + 0.002);
  const STITCHES = 9;
  for (let i = 0; i < STITCHES; i++) {
    const y = seamBottom + 0.02 + ((seamTop - seamBottom - 0.04) * i) / (STITCHES - 1);
    const st = add(root, new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.01, 0.01), stitchMat), seamX, y, FRONT_Z + 0.004);
    st.rotation.z = -0.18;
  }

  // The valve on the top's left: a brass socket, a glass envelope, and a filament with its own glow.
  add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.04, 20), brassWorn), VALVE.x, TOP_Y + 0.02, VALVE.z);
  const envelope = add(root, new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.085, 6, 18), envelopeMat), VALVE.x, TOP_Y + 0.125, VALVE.z);
  envelope.renderOrder = 4;
  const filament = add(root, new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 6, 18), filamentMat), VALVE.x, TOP_Y + 0.12, VALVE.z);
  for (const sx of [-1, 1]) add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.07, 6), brassDark), VALVE.x + sx * 0.016, TOP_Y + 0.075, VALVE.z);
  add(root, ball(0.016, brass), VALVE.x, TOP_Y + 0.205, VALVE.z);
  const valveGlow = add(root, new THREE.Sprite(sprite(COL.arcOuter)), VALVE.x, TOP_Y + 0.12, VALVE.z + 0.05);
  valveGlow.scale.setScalar(0.26);
  valveGlow.renderOrder = 5;

  // The arm's turret on the top's right.
  add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.04, 24), brassWorn), SHOULDER.x, TOP_Y + 0.02, SHOULDER.z);
  add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.05, 20), brass), SHOULDER.x, TOP_Y + 0.055, SHOULDER.z);

  /** A hinge knuckle: a brass ball between two side plates, its pin across the arm's plane (local x). */
  const knuckle = (parent: THREE.Object3D) => {
    parent.add(ball(0.03, brass));
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.06, 20), brassWorn);
    pin.rotation.z = Math.PI / 2;
    parent.add(pin);
  };
  // The shoulder turns about the vertical (the arm's plane) and then leans forward in that plane.
  const shoulder = add(root, new THREE.Group(), SHOULDER.x, SHOULDER.y, SHOULDER.z);
  shoulder.rotation.order = "YXZ";
  shoulder.rotation.y = ARM.yaw;
  knuckle(shoulder);
  for (const sx of [-0.019, 0.019]) add(shoulder, new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, ARM.upper, 10), brass), sx, ARM.upper / 2, 0);
  add(shoulder, new THREE.Mesh(new THREE.TubeGeometry(new Helix(0.014, ARM.upper * 0.62, 9), 90, 0.0035, 5), brassDark), 0, ARM.upper * 0.19, -0.03);
  const elbow = add(shoulder, new THREE.Group(), 0, ARM.upper, 0);
  knuckle(elbow);
  add(elbow, new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, ARM.fore, 12), brass), 0, ARM.fore / 2, 0);
  const wrist = add(elbow, new THREE.Group(), 0, ARM.fore, 0);

  // The tube head, looking down its own +z: housing, back dome, front ring, cone and the window, then the electrodes.
  const head = add(wrist, new THREE.Group());
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(HEAD.r, HEAD.r, HEAD.len, 28), brass);
  housing.rotation.x = Math.PI / 2;
  head.add(housing);
  const dome = add(head, new THREE.Mesh(new THREE.SphereGeometry(HEAD.r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), brassWorn), 0, 0, -HEAD.len / 2);
  dome.rotation.x = -Math.PI / 2;
  dome.scale.set(1, 0.55, 1);
  add(head, new THREE.Mesh(new THREE.TorusGeometry(HEAD.r, 0.009, 10, 32), brassWorn), 0, 0, HEAD.len / 2);
  add(head, new THREE.Mesh(new THREE.TorusGeometry(HEAD.r, 0.007, 10, 32), brassDark), 0, 0, -HEAD.len / 6);
  const cone = add(head, new THREE.Mesh(new THREE.CylinderGeometry(HEAD.window + 0.008, HEAD.r * 0.85, HEAD.coneLen, 24), brassWorn), 0, 0, HEAD.len / 2 + HEAD.coneLen / 2);
  cone.rotation.x = Math.PI / 2;
  const aperture = add(head, new THREE.Mesh(new THREE.CircleGeometry(HEAD.window, 24), apertureMat), 0, 0, APERTURE_Z);
  const apertureGlow = add(head, new THREE.Sprite(sprite(COL.ecto)), 0, 0, APERTURE_Z + 0.03);
  apertureGlow.scale.setScalar(0.2);
  apertureGlow.renderOrder = 5;
  for (const sx of [-1, 1]) {
    add(head, new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, TERMINAL.y - HEAD.r + 0.01, 8), brassDark), sx * TERMINAL.x, (TERMINAL.y + HEAD.r) / 2 - 0.01, TERMINAL.z);
    add(head, ball(0.013, brass), sx * TERMINAL.x, TERMINAL.y, TERMINAL.z);
  }
  const arcGroup = add(head, new THREE.Group(), 0, TERMINAL.y, TERMINAL.z);
  const arcs: THREE.Mesh[] = [];
  for (let i = 0; i < ARC_BOLTS * ARC_SEGMENTS; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.007, 1, 0.007), arcMat);
    seg.renderOrder = 6;
    arcGroup.add(seg);
    arcs.push(seg);
  }
  const arcGlow = add(head, new THREE.Sprite(sprite(COL.gold)), 0, TERMINAL.y + 0.02, TERMINAL.z);
  arcGlow.scale.setScalar(0.24);
  arcGlow.renderOrder = 6;

  // The beam, narrow at y = 0 and as wide as the glass at y = 1; the engine stretches it from the window to the glass.
  const beamGeo = new THREE.CylinderGeometry(SCREEN.w * 0.42, HEAD.window * 0.9, 1, 24, 1, true);
  beamGeo.translate(0, 0.5, 0);
  const beam = add(root, new THREE.Mesh(beamGeo, beamMat));
  beam.renderOrder = 5;

  // The floor: a soft shadow under the plinth, flat-on to the camera.
  const shadow = add(root, new THREE.Sprite(sprite(COL.night0, THREE.NormalBlending)), 0.05, 0.01, 0.05);
  shadow.scale.set(1.35, 0.34, 1);
  shadow.renderOrder = -1;

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      // A sprite's geometry is shared by every sprite in three.js, so it is left alone.
      if (mesh.isMesh) mesh.geometry.dispose();
      const mat = (o as THREE.Mesh | THREE.Sprite).material as THREE.Material | undefined;
      if (mat !== undefined) seen.add(mat);
    });
    for (const m of seen) m.dispose();
    for (const tex of [grainA, grainB, glow, film, glassGlow, scanTex, beamTex]) tex.dispose();
  };

  return {
    root,
    glass,
    bones,
    scanLine,
    screenGlow,
    dialFace,
    needle,
    knob,
    filament,
    valveGlow,
    shoulder,
    elbow,
    head,
    aperture,
    apertureGlow,
    arcs,
    arcGroup,
    arcGlow,
    beam,
    shadow,
    dispose,
  };
}
