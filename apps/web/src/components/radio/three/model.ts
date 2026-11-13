// The radio, built from three.js primitives with no model files: a small tabletop "tombstone" set in the wall phone's
// oak and brass, so the two read as one lab's things. An upright oak cabinet with a round top on a darker plinth and
// four feet; a big round speaker of dark cloth behind a brass ring and four brass bars; a wide dial window with a
// pale face, tick marks and a thin needle; two brass knobs; a row of dark stitches down the front's left edge,
// because Franki is stitched together and so are his things; and a short brass antenna from the back of the top,
// leaning out, with a ball tip that crackles while the radio tunes. Colours come from the ghost's own palette.
// Units: the cabinet is 0.8 wide and stands on y = 0.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { C, COL } from "../../avatar/three/config";
import { mulberry32 } from "../../avatar/three/math";

/** The cabinet's size: its straight sides end at SHOULDER, and the round top is a half circle of HALF_W. */
export const CAB_HALF_W = 0.4;
export const CAB_BOTTOM = 0.1;
export const CAB_SHOULDER = 0.6;
export const CAB_DEPTH = 0.34;
const BEVEL = 0.03;
/** The cabinet's front face, in the radio's own space. */
export const FRONT_Z = CAB_DEPTH / 2 + BEVEL;

/** The speaker: the round opening in the upper part of the front. */
export const SPEAKER = { x: 0, y: 0.64, r: 0.25 } as const;
/** The dial window under the speaker: its middle, and the needle's reach either side. */
export const DIAL = { x: 0, y: 0.28, w: 0.54, h: 0.12, reach: 0.23 } as const;
export const KNOB_Y = 0.165;
export const KNOB_X = 0.2;
/** Where the antenna leaves the cabinet, and its tip once leaned. */
export const ANTENNA_BASE = new THREE.Vector3(-0.17, 0.92, -0.06);
export const ANTENNA_LENGTH = 0.5;
export const ANTENNA_LEAN = 0.38;
export const ANTENNA_TIP = new THREE.Vector3(
  ANTENNA_BASE.x - Math.sin(ANTENNA_LEAN) * ANTENNA_LENGTH,
  ANTENNA_BASE.y + Math.cos(ANTENNA_LEAN) * ANTENNA_LENGTH,
  ANTENNA_BASE.z,
);
/** The crackle at the tip: bolts of a few segments each. */
export const ARC_BOLTS = 2;
export const ARC_SEGMENTS = 3;
/** The rings and notes that drift up from the speaker. */
export const DRIFTERS = 3;

export interface RadioModel {
  /** Everything that stands on the floor; the engine turns this and bobs it. */
  root: THREE.Group;
  /** The cloth and its cap, which pulse. */
  speaker: THREE.Group;
  /** The dial face, whose glow is the radio's main light. */
  dialFace: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  dialGlow: THREE.Sprite;
  needle: THREE.Mesh;
  knobs: [THREE.Group, THREE.Group];
  tip: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  tipGlow: THREE.Sprite;
  /** The crackle's segments, ARC_BOLTS × ARC_SEGMENTS thin boxes, children of the tip's group. */
  arcs: THREE.Mesh[];
  arcGroup: THREE.Group;
  /** Rings and notes drifting from the speaker. They live in the scene, not in the root, so they don't bob or turn. */
  drifters: THREE.Object3D[];
  /** The soft brass glow under the radio while the globe is open, and its shadow on the floor. */
  sourceGlow: THREE.Sprite;
  shadow: THREE.Sprite;
  dispose(): void;
}

/** Vertical wood grain as a small greyscale texture, as on the phone. */
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
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Speaker cloth: a close basket weave, light threads over dark. */
function weaveTexture(): THREE.DataTexture {
  const N = 32;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const over = ((x >> 1) + (y >> 1)) % 2 === 0;
      const edge = x % 2 === 0 || y % 2 === 0;
      const v = over ? (edge ? 150 : 205) : edge ? 70 : 110;
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
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

/** The cabinet's outline: straight sides and a half-round top, with the speaker cut through. */
function cabinetShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-CAB_HALF_W, CAB_BOTTOM);
  s.lineTo(CAB_HALF_W, CAB_BOTTOM);
  s.lineTo(CAB_HALF_W, CAB_SHOULDER);
  s.absarc(0, CAB_SHOULDER, CAB_HALF_W, 0, Math.PI, false);
  s.lineTo(-CAB_HALF_W, CAB_BOTTOM);
  s.holes.push(new THREE.Path().absarc(SPEAKER.x, SPEAKER.y, SPEAKER.r, 0, Math.PI * 2, true));
  return s;
}

export function buildRadio(): RadioModel {
  const grainA = grainTexture(11), grainB = grainTexture(31);
  const weave = weaveTexture();
  const glow = glowTexture();

  // Exactly the phone's woods and metals, so the two props are one set.
  const oak = C(COL.scarCut).lerp(C(COL.brass), 0.2);
  const walnut = C(COL.scarCut).lerp(C(COL.lamp), 0.35).lerp(C(COL.brass), 0.12);
  const woodFront = new THREE.MeshPhysicalMaterial({ color: oak, map: grainA, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.28 });
  const woodBase = new THREE.MeshPhysicalMaterial({ color: walnut, map: grainB, roughness: 0.58, clearcoat: 0.4, clearcoatRoughness: 0.35 });
  const brass = new THREE.MeshStandardMaterial({ color: C(COL.brassBase), metalness: 1, roughness: 0.26 });
  const brassWorn = new THREE.MeshStandardMaterial({ color: C(COL.brass), metalness: 1, roughness: 0.42 });
  const cloth = new THREE.MeshStandardMaterial({ color: C(COL.night2).lerp(C(COL.scarGroove), 0.55), map: weave, roughness: 0.95 });
  const hollow = new THREE.MeshStandardMaterial({ color: C(COL.bead), roughness: 0.9, side: THREE.DoubleSide });
  const stitchMat = new THREE.MeshStandardMaterial({ color: C(COL.hairRoot), roughness: 0.7 });
  const needleMat = new THREE.MeshBasicMaterial({ color: C(COL.scarGroove), toneMapped: false });
  const tickMat = new THREE.MeshBasicMaterial({ color: C(COL.scarCut), toneMapped: false });
  // The face is a dim ivory lit from inside: the engine drives its emissive colour and strength.
  const faceMat = new THREE.MeshStandardMaterial({ color: C(COL.mote).lerp(C(COL.lamp), 0.55), roughness: 0.6, emissive: C(COL.arcOuter), emissiveIntensity: 0 });
  const tipMat = new THREE.MeshStandardMaterial({ color: C(COL.brassBase), metalness: 1, roughness: 0.22, emissive: C(COL.gold), emissiveIntensity: 0 });
  const sprite = (col: number, blending: THREE.Blending = THREE.AdditiveBlending) =>
    new THREE.SpriteMaterial({ map: glow, color: C(col), transparent: true, opacity: 0, depthWrite: false, blending });
  const arcMat = new THREE.MeshBasicMaterial({ color: C(COL.spark), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const driftMat = () => new THREE.MeshBasicMaterial({ color: C(COL.ecto), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });

  const root = new THREE.Group();
  const add = <T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T => {
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const box = (w: number, h: number, d: number, r: number, mat: THREE.Material) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
  /** A cylinder whose axis points out of the radio's face. */
  const disc = (r: number, depth: number, mat: THREE.Material, seg = 40) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, seg), mat);
    m.rotation.x = Math.PI / 2;
    return m;
  };

  // The cabinet, extruded from its outline and centred on z = 0.
  const cabGeo = new THREE.ExtrudeGeometry(cabinetShape(), { depth: CAB_DEPTH, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 3, curveSegments: 40 });
  cabGeo.translate(0, 0, -CAB_DEPTH / 2);
  // Extrude UVs are in shape units; stretch the grain so it runs up the front.
  const uv = cabGeo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.6, uv.getY(i) * 0.9);
  add(root, new THREE.Mesh(cabGeo, woodFront));
  // A back panel closes the speaker's hole from behind.
  add(root, disc(SPEAKER.r + 0.01, 0.02, hollow), SPEAKER.x, SPEAKER.y, -CAB_DEPTH / 2 + 0.02);

  // The plinth and four feet.
  add(root, box(CAB_HALF_W * 2 + 0.1, 0.08, CAB_DEPTH + 0.14, 0.025, woodBase), 0, CAB_BOTTOM - 0.03, 0);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.06, 16), woodBase), sx * (CAB_HALF_W - 0.02), 0.03, sz * (CAB_DEPTH / 2 - 0.01));
  }

  // The speaker: dark cloth set back in the opening, domed a little so it can push out, with a cap in the middle.
  const speaker = add(root, new THREE.Group(), SPEAKER.x, SPEAKER.y, FRONT_Z - 0.07);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SPEAKER.r * 2.2, 40, 8, 0, Math.PI * 2, 0, Math.asin(1 / 2.2)), cloth);
  dome.rotation.x = Math.PI / 2;
  dome.position.z = -SPEAKER.r * 2.2 * Math.cos(Math.asin(1 / 2.2));
  speaker.add(dome);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.03;
  speaker.add(cap);
  // The brass ring round the opening and four bars across it, clear of the cap in the middle.
  add(root, new THREE.Mesh(new THREE.TorusGeometry(SPEAKER.r + 0.005, 0.024, 14, 64), brass), SPEAKER.x, SPEAKER.y, FRONT_Z - 0.004);
  for (const dy of [-0.135, -0.05, 0.05, 0.135]) {
    const half = Math.sqrt(SPEAKER.r * SPEAKER.r - dy * dy);
    const bar = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, half * 2, 12), brassWorn), SPEAKER.x, SPEAKER.y + dy, FRONT_Z - 0.02);
    bar.rotation.z = Math.PI / 2;
  }

  // The dial window: a brass frame, the face, its ticks and the needle.
  add(root, box(DIAL.w + 0.05, DIAL.h + 0.05, 0.03, 0.02, brass), DIAL.x, DIAL.y, FRONT_Z);
  const dialFace = add(root, new THREE.Mesh(new THREE.PlaneGeometry(DIAL.w, DIAL.h), faceMat), DIAL.x, DIAL.y, FRONT_Z + 0.017);
  const TICKS = 11;
  for (let i = 0; i < TICKS; i++) {
    const long = i % 5 === 0;
    const x = DIAL.x - DIAL.reach + (2 * DIAL.reach * i) / (TICKS - 1);
    add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.008, long ? 0.05 : 0.03), tickMat), x, DIAL.y - DIAL.h / 2 + (long ? 0.035 : 0.025), FRONT_Z + 0.018);
  }
  const needle = add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.01, DIAL.h * 0.86), needleMat), DIAL.x - DIAL.reach, DIAL.y, FRONT_Z + 0.019);
  const dialGlow = add(root, new THREE.Sprite(sprite(COL.arcOuter)), DIAL.x, DIAL.y, FRONT_Z + 0.06);
  dialGlow.scale.set(DIAL.w * 1.5, DIAL.h * 3.2, 1);

  // Two brass knobs, each with a dark mark so a turn shows.
  const makeKnob = (x: number): THREE.Group => {
    const g = add(root, new THREE.Group(), x, KNOB_Y, FRONT_Z + 0.01);
    const body = disc(0.055, 0.05, brass, 28);
    body.position.z = 0.02;
    const face = disc(0.045, 0.012, brassWorn, 28);
    face.position.z = 0.048;
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.04, 0.008), stitchMat);
    mark.position.set(0, 0.022, 0.056);
    g.add(body, face, mark);
    return g;
  };
  const knobs: [THREE.Group, THREE.Group] = [makeKnob(-KNOB_X), makeKnob(KNOB_X)];

  // Stitches down the front's left edge: a seam line and short crossing stitches.
  const seamX = -CAB_HALF_W + 0.055;
  const seamTop = CAB_SHOULDER + 0.02, seamBottom = CAB_BOTTOM + 0.05;
  add(root, new THREE.Mesh(new THREE.BoxGeometry(0.006, seamTop - seamBottom, 0.006), stitchMat), seamX, (seamTop + seamBottom) / 2, FRONT_Z + 0.002);
  const STITCHES = 7;
  for (let i = 0; i < STITCHES; i++) {
    const y = seamBottom + 0.02 + ((seamTop - seamBottom - 0.04) * i) / (STITCHES - 1);
    const st = add(root, new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.011, 0.01), stitchMat), seamX, y, FRONT_Z + 0.004);
    st.rotation.z = 0.18;
  }

  // The antenna: a brass collar on the top, a rod leaning out, a ball tip with its own glow and crackle.
  add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.04, 16), brassWorn), ANTENNA_BASE.x, ANTENNA_BASE.y - 0.01, ANTENNA_BASE.z);
  const rod = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, ANTENNA_LENGTH, 10), brass));
  rod.position.copy(ANTENNA_BASE).lerp(ANTENNA_TIP, 0.5);
  rod.rotation.z = ANTENNA_LEAN;
  const tip = add(root, new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), tipMat), ANTENNA_TIP.x, ANTENNA_TIP.y, ANTENNA_TIP.z);
  const tipGlow = add(root, new THREE.Sprite(sprite(COL.gold)), ANTENNA_TIP.x, ANTENNA_TIP.y, ANTENNA_TIP.z + 0.02);
  tipGlow.scale.setScalar(0.24);
  const arcGroup = add(root, new THREE.Group(), ANTENNA_TIP.x, ANTENNA_TIP.y, ANTENNA_TIP.z);
  const arcs: THREE.Mesh[] = [];
  for (let i = 0; i < ARC_BOLTS * ARC_SEGMENTS; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.009, 1, 0.009), arcMat);
    seg.renderOrder = 5;
    arcGroup.add(seg);
    arcs.push(seg);
  }

  // The floor: a soft shadow under the plinth, and the brass glow for the open globe. Both lie flat-on to the camera.
  const shadow = add(root, new THREE.Sprite(sprite(COL.night0, THREE.NormalBlending)), 0, 0.01, 0.05);
  shadow.scale.set(1.3, 0.34, 1);
  shadow.renderOrder = -1;
  const sourceGlow = add(root, new THREE.Sprite(sprite(COL.brass)), 0, 0.06, 0.1);
  sourceGlow.scale.set(1.5, 0.5, 1);

  // Rings and notes from primitives: a torus for a ring, a squashed ball on a stem for a note.
  const drifters: THREE.Object3D[] = [];
  for (let i = 0; i < DRIFTERS; i++) {
    if (i === 1) {
      const note = new THREE.Group();
      const mat = driftMat();
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), mat);
      head.scale.set(1.25, 0.9, 0.6);
      head.rotation.z = 0.4;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.12, 8), mat);
      stem.position.set(0.034, 0.06, 0);
      note.add(head, stem);
      note.renderOrder = 5;
      drifters.push(note);
    } else {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 8, 32), driftMat());
      ring.renderOrder = 5;
      drifters.push(ring);
    }
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const seen = new Set<THREE.Material>();
    for (const top of [root, ...drifters]) {
      top.traverse((o) => {
        const mesh = o as THREE.Mesh;
        // A sprite's geometry is shared by every sprite in three.js, so it is left alone.
        if (mesh.isMesh) mesh.geometry.dispose();
        const mat = (o as THREE.Mesh | THREE.Sprite).material as THREE.Material | undefined;
        if (mat !== undefined) seen.add(mat);
      });
    }
    for (const m of seen) m.dispose();
    grainA.dispose();
    grainB.dispose();
    weave.dispose();
    glow.dispose();
  };

  return { root, speaker, dialFace, dialGlow, needle, knobs, tip, tipGlow, arcs, arcGroup, drifters, sourceGlow, shadow, dispose };
}
