// The wall phone, built from three.js primitives with no model files, in the radio's and the X-ray machine's oak
// and brass so the three read as one lab's things: a walnut backboard with an arched top and a routed edge; an oak
// cabinet with walnut caps and brass screws; two brass bells on a brass bar with a clapper between them; an oak
// panel in a walnut frame holding the dial (an ivory number plate under a brass finger wheel, with a glass jewel
// lamp in a brass bezel at its middle); a row of dark stitches across the panel under the dial, because Franki is
// stitched together and so are his things; a brass nameplate; a crank on a brass hub at the right; a writing shelf
// below; and a black handset on a brass cradle at the left with a coiled cord. A faint green glow behind it is
// Franki's, holding it up. Colours come from the ghost's own palette (avatar/three/config.ts). Units: the cabinet is
// 0.74 wide.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { C, COL } from "../../avatar/three/config";
import { mulberry32 } from "../../avatar/three/math";

/** Where the finger wheel's holes sit: ten of them on one circle, leaving a gap at the finger stop. */
export const WHEEL_HOLES = 10;
export const WHEEL_HOLE_RING = 0.15;
export const holeAngle = (i: number) => THREE.MathUtils.degToRad(-60 + i * 30);

/**
 * The handset's two rests, in the phone's own space. The engine blends between them. Lifted, it floats a little
 * above and in front of its cradle, tipped toward Franki, and stays beside the phone.
 */
export const HANDSET_REST = {
  hook: { position: new THREE.Vector3(-0.57, 0.0, 0.25), rotation: new THREE.Euler(0, 0, 0) },
  lifted: { position: new THREE.Vector3(-0.63, 0.1, 0.5), rotation: new THREE.Euler(-0.12, -0.1, 0.2, "YXZ") },
} as const;

/** The backboard: its half width, its bottom, where its sides end and the arch begins, and the arch's height. */
export const BOARD = { halfW: 0.47, bottom: -0.98, shoulder: 0.72, arch: 0.26 } as const;

/** The handset's ends along its own Y axis: the earpiece on top, the cord at the bottom. */
export const HANDSET_EAR_Y = 0.27;
export const HANDSET_CORD_Y = -0.33;
/** Where the cord leaves the cabinet. */
export const CORD_ROOT = new THREE.Vector3(-0.24, -0.46, 0.2);

export interface PhoneModel {
  /** Everything; the engine scales and turns this. */
  root: THREE.Group;
  bells: [THREE.Group, THREE.Group];
  clapper: THREE.Group;
  wheel: THREE.Mesh;
  handset: THREE.Group;
  cord: THREE.Mesh;
  lamp: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  lampGlow: THREE.Sprite;
  /** Franki's faint green glow behind the phone. It floats with it. */
  aura: THREE.Sprite;
  /** Three arcs that leave the earpiece while Franki talks. They live in the scene, not in the root. */
  waves: THREE.Mesh[];
  /** Short strokes that flash off the bells while they ring. In the scene, not in the root. */
  ticks: THREE.Mesh[];
  /** Rebuilds the cord between the cabinet and the handset's lower end. */
  setCord(end: THREE.Vector3): void;
  dispose(): void;
}

/**
 * Vertical wood grain as a small greyscale texture: broad bands with fine streaks in them, wandering a little along
 * the board. The phone is drawn smaller than the radio, so its grain is bolder to read the same on screen.
 */
function grainTexture(seed: number): THREE.DataTexture {
  const W = 64, H = 128, BANDS = 9;
  const rnd = mulberry32(seed);
  const streak = Array.from({ length: W }, () => rnd());
  const band = Array.from({ length: BANDS }, () => rnd());
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const wander = 3 * Math.sin(y * 0.09 + seed) + 1.4 * Math.sin(y * 0.26 + seed * 2);
    for (let x = 0; x < W; x++) {
      const u = x + wander;
      const i0 = ((Math.floor(u) % W) + W) % W, i1 = (i0 + 1) % W, f = u - Math.floor(u);
      const s = streak[i0]! * (1 - f) + streak[i1]! * f;
      // The bands, eased between their values so they read as soft wide stripes.
      const bu = ((((u / W) * BANDS) % BANDS) + BANDS) % BANDS;
      const b0 = Math.floor(bu), bf = bu - b0, be = bf * bf * (3 - 2 * bf);
      const b = band[b0]! * (1 - be) + band[(b0 + 1) % BANDS]! * be;
      const v = Math.round(255 * (0.64 + 0.2 * b + 0.16 * s - 0.04 * rnd()));
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

/** A coil wound round a drooping path from `a` to `d`. The coil closes to nothing at both ends, so it meets its anchors. */
class CoilCurve extends THREE.Curve<THREE.Vector3> {
  readonly a = new THREE.Vector3();
  readonly b = new THREE.Vector3();
  readonly c = new THREE.Vector3();
  readonly d = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly bn = new THREE.Vector3();
  private static readonly REF = new THREE.Vector3(0, 0, 1);

  constructor(readonly turns: number, readonly radius: number) {
    super();
    this.arcLengthDivisions = 600;
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const u = 1 - t;
    const { a, b, c, d, tan, n, bn } = this;
    tan.set(0, 0, 0).addScaledVector(a, -3 * u * u).addScaledVector(b, 3 * u * u - 6 * u * t).addScaledVector(c, 6 * u * t - 3 * t * t).addScaledVector(d, 3 * t * t).normalize();
    n.crossVectors(tan, CoilCurve.REF).normalize();
    bn.crossVectors(tan, n);
    const r = this.radius * Math.min(1, t / 0.07, (1 - t) / 0.07);
    const ang = this.turns * 2 * Math.PI * t;
    return target.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t)
      .addScaledVector(n, r * Math.cos(ang)).addScaledVector(bn, r * Math.sin(ang));
  }
}

/** The backboard's outline: straight sides and a low arch over the bells. */
function boardShape(): THREE.Shape {
  const { halfW, bottom, shoulder, arch } = BOARD;
  const s = new THREE.Shape();
  s.moveTo(-halfW, bottom);
  s.lineTo(halfW, bottom);
  s.lineTo(halfW, shoulder);
  s.absellipse(0, shoulder, halfW, arch, 0, Math.PI, false, 0);
  s.lineTo(-halfW, bottom);
  return s;
}

export function buildPhone(): PhoneModel {
  const grainA = grainTexture(7), grainB = grainTexture(23);
  const glow = glowTexture();

  // Exactly the radio's and the X-ray machine's woods and metals, so the props are one set.
  const oak = C(COL.scarCut).lerp(C(COL.brass), 0.2);
  const walnut = C(COL.scarCut).lerp(C(COL.lamp), 0.35).lerp(C(COL.brass), 0.12);
  const woodFront = new THREE.MeshPhysicalMaterial({ color: oak, map: grainA, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.28 });
  const woodBack = new THREE.MeshPhysicalMaterial({ color: walnut, map: grainB, roughness: 0.58, clearcoat: 0.4, clearcoatRoughness: 0.35 });
  // The backboard is oak too, with its own grain, so the phone reads as warm as the radio; walnut trims it.
  const woodBoard = new THREE.MeshPhysicalMaterial({ color: oak, map: grainB, roughness: 0.52, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const brass = new THREE.MeshStandardMaterial({ color: C(COL.brassBase), metalness: 1, roughness: 0.26 });
  const brassWorn = new THREE.MeshStandardMaterial({ color: C(COL.brass), metalness: 1, roughness: 0.42 });
  const black = new THREE.MeshPhysicalMaterial({ color: C(COL.hairRoot), roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const blackInside = new THREE.MeshStandardMaterial({ color: C(COL.bead), roughness: 0.8, side: THREE.DoubleSide });
  const ivory = new THREE.MeshStandardMaterial({ color: C(COL.mote), roughness: 0.7 });
  const cordMat = new THREE.MeshStandardMaterial({ color: C(COL.hairBase), roughness: 0.55 });
  const stitchMat = new THREE.MeshStandardMaterial({ color: C(COL.hairRoot), roughness: 0.7 });
  // The jewel: dark amber glass cut in facets, lit from inside. The engine drives its emissive colour and strength.
  const lampMat = new THREE.MeshStandardMaterial({ color: C(COL.lamp), roughness: 0.16, flatShading: true, emissive: C(COL.brassDeep), emissiveIntensity: 1 });
  const sprite = (col: number) => new THREE.SpriteMaterial({ map: glow, color: C(col), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  // Mint: the waves cross the dark room between the phone and Franki.
  const waveMat = () => new THREE.MeshBasicMaterial({ color: C(COL.ecto), transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false });
  const tickMat = () => new THREE.MeshBasicMaterial({ color: C(COL.gold), transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false });

  const root = new THREE.Group();
  const add = <T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T => {
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const box = (w: number, h: number, d: number, r: number, mat: THREE.Material) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat);
  /** A cylinder whose axis points out of the phone's face. */
  const disc = (r: number, depth: number, mat: THREE.Material, seg = 40) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, seg), mat);
    m.rotation.x = Math.PI / 2;
    return m;
  };
  /** A round-headed brass screw sitting on a face at depth `z`. */
  const screw = (x: number, y: number, z: number, r = 0.018) => {
    const head = add(root, new THREE.Mesh(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), brassWorn), x, y, z);
    head.rotation.x = Math.PI / 2;
    head.scale.y = 0.5;
    return head;
  };

  // Franki's glow behind the phone: only its edge shows past the backboard.
  const aura = add(root, new THREE.Sprite(sprite(COL.ecto)), 0, 0.02, -0.16);
  aura.scale.set(2.5, 2.9, 1);
  aura.renderOrder = -1;

  // The backboard, extruded from its outline with a rounded edge, its front face on z = 0.
  const boardGeo = new THREE.ExtrudeGeometry(boardShape(), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 3, curveSegments: 36 });
  boardGeo.translate(0, 0, -0.062);
  // Extrude UVs are in shape units; stretch the grain so it runs up the board.
  const boardUv = boardGeo.getAttribute("uv");
  for (let i = 0; i < boardUv.count; i++) boardUv.setXY(i, boardUv.getX(i) * 1.4, boardUv.getY(i) * 0.55);
  add(root, new THREE.Mesh(boardGeo, woodBoard));
  for (const [x, y] of [[-0.4, 0.66], [0.4, 0.66], [0, 0.93], [-0.4, -0.91], [0.4, -0.91]] as const) screw(x, y, 0.002);

  // The cabinet, with walnut caps above and below.
  add(root, box(0.74, 0.92, 0.36, 0.035, woodFront), 0, 0.02, 0.18);
  add(root, box(0.82, 0.07, 0.42, 0.02, woodBack), 0, 0.5, 0.2);
  add(root, box(0.8, 0.06, 0.4, 0.02, woodBack), 0, -0.455, 0.19);
  for (const [x, y] of [[-0.33, 0.43], [0.33, 0.43], [-0.33, -0.395], [0.33, -0.395]] as const) screw(x, y, 0.36, 0.015);
  // An oak panel behind the dial in a walnut frame.
  const panelZ = 0.365;
  add(root, box(0.6, 0.66, 0.02, 0.01, woodFront), 0, 0.05, panelZ);
  for (const y of [0.38, -0.28]) add(root, box(0.64, 0.035, 0.03, 0.012, woodBack), 0, y, panelZ + 0.01);
  for (const x of [-0.3, 0.3]) add(root, box(0.035, 0.695, 0.03, 0.012, woodBack), x, 0.05, panelZ + 0.01);
  // A brass nameplate under the panel, with two engraved lines and a screw at each end.
  add(root, box(0.2, 0.05, 0.012, 0.005, brass), 0, -0.36, 0.366);
  for (const [w, y] of [[0.12, -0.352], [0.08, -0.368]] as const) add(root, new THREE.Mesh(new THREE.BoxGeometry(w, 0.006, 0.004), stitchMat), 0, y, 0.373);
  for (const x of [-0.085, 0.085]) screw(x, -0.36, 0.372, 0.008);

  // The bells: two shallow brass domes facing out, each with a rolled rim, on its own pivot so it can shake.
  const bellProfile = [[0.0, 0.075], [0.035, 0.072], [0.085, 0.058], [0.13, 0.03], [0.155, 0.0], [0.148, -0.004], [0.12, 0.018], [0.0, 0.05]].map(([r, y]) => new THREE.Vector2(r!, y!));
  const makeBell = (x: number): THREE.Group => {
    const g = add(root, new THREE.Group(), x, 0.745, 0.05);
    const dome = new THREE.Mesh(new THREE.LatheGeometry(bellProfile, 48), brass);
    dome.rotation.x = Math.PI / 2;
    dome.position.z = 0.03;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.007, 8, 56), brassWorn);
    lip.position.z = 0.03;
    const nut = disc(0.026, 0.03, brassWorn, 6);
    nut.position.z = 0.115;
    const post = disc(0.02, 0.06, blackInside, 12);
    g.add(dome, lip, nut, post);
    return g;
  };
  const bells: [THREE.Group, THREE.Group] = [makeBell(-0.185), makeBell(0.185)];
  // The clapper swings on a pivot under the gap between the bells.
  const clapper = add(root, new THREE.Group(), 0, 0.59, 0.11);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.15, 8), brassWorn);
  arm.position.y = 0.075;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.026, 20, 14), brass);
  ball.position.y = 0.155;
  clapper.add(arm, ball, disc(0.02, 0.03, brassWorn, 12));

  // The dial: an ivory plate, a brass rim, and the finger wheel with real holes.
  const dialY = 0.07, dialZ = 0.375;
  add(root, disc(0.225, 0.012, ivory), 0, dialY, dialZ + 0.006);
  add(root, new THREE.Mesh(new THREE.TorusGeometry(0.228, 0.02, 14, 64), brass), 0, dialY, dialZ + 0.012);
  const wheelShape = new THREE.Shape().absarc(0, 0, 0.198, 0, Math.PI * 2, false);
  for (let i = 0; i < WHEEL_HOLES; i++) {
    const a = holeAngle(i);
    wheelShape.holes.push(new THREE.Path().absarc(Math.cos(a) * WHEEL_HOLE_RING, Math.sin(a) * WHEEL_HOLE_RING, 0.03, 0, Math.PI * 2, true));
  }
  const wheel = add(root, new THREE.Mesh(
    new THREE.ExtrudeGeometry(wheelShape, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 28 }),
    brassWorn,
  ), 0, dialY, dialZ + 0.02);
  const cap = disc(0.07, 0.014, brass, 32);
  cap.position.z = 0.03;
  wheel.add(cap);
  // The finger stop, fixed to the rim at about four o'clock.
  const stop = add(root, box(0.075, 0.016, 0.03, 0.006, brass), 0.19, dialY - 0.13, dialZ + 0.04);
  stop.rotation.z = THREE.MathUtils.degToRad(-35);
  // The jewel lamp in the middle of the cap, in a brass bezel. Neither turns with the wheel.
  const lamp = add(root, new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 6), lampMat), 0, dialY, dialZ + 0.058);
  lamp.scale.z = 0.6;
  add(root, new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 10, 28), brass), 0, dialY, dialZ + 0.058);
  const lampGlow = add(root, new THREE.Sprite(sprite(COL.ecto)), 0, dialY, dialZ + 0.09);
  lampGlow.scale.setScalar(0.42);

  // Stitches across the panel under the dial: a seam line and short crossing stitches.
  const seamY = -0.225, seamHalf = 0.2, seamZ = panelZ + 0.01;
  add(root, new THREE.Mesh(new THREE.BoxGeometry(seamHalf * 2, 0.006, 0.006), stitchMat), 0, seamY, seamZ + 0.002);
  const STITCHES = 7;
  for (let i = 0; i < STITCHES; i++) {
    const st = add(root, new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.046, 0.01), stitchMat), -seamHalf + 0.02 + ((seamHalf * 2 - 0.04) * i) / (STITCHES - 1), seamY, seamZ + 0.004);
    st.rotation.z = 0.18;
  }

  // The crank on the right: a brass hub on the cabinet's side, an axle, an arm and a dark knob.
  const hub = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 24), brassWorn), 0.374, 0.02, 0.2);
  hub.rotation.z = Math.PI / 2;
  const axle = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 16), brassWorn), 0.415, 0.02, 0.2);
  axle.rotation.z = Math.PI / 2;
  const crankArm = add(root, box(0.022, 0.2, 0.034, 0.008, brass), 0.47, -0.06, 0.2);
  crankArm.rotation.x = 0.35;
  const knob = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.1, 18), black), 0.525, -0.15, 0.168);
  knob.rotation.z = Math.PI / 2;

  // The shelf: a sloped writing board on two brackets.
  const shelf = add(root, box(0.8, 0.03, 0.34, 0.012, woodFront), 0, -0.66, 0.19);
  shelf.rotation.x = 0.4;
  add(root, box(0.8, 0.045, 0.03, 0.01, woodBack), 0, -0.735, 0.345).rotation.x = 0.4;
  for (const sx of [-1, 1]) add(root, box(0.03, 0.2, 0.22, 0.01, woodBack), sx * 0.34, -0.74, 0.1).rotation.x = 0.4;

  // The cradle on the left: a bar from the cabinet's side and two prongs the handset hangs between.
  const hookY = HANDSET_REST.hook.position.y + HANDSET_EAR_Y - 0.075;
  const bar = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 12), brass), -0.5, hookY, 0.16);
  bar.rotation.z = Math.PI / 2;
  for (const dx of [-0.052, 0.052]) {
    const prong = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.17, 10), brass), HANDSET_REST.hook.position.x + dx, hookY, 0.24);
    prong.rotation.x = Math.PI / 2;
    add(root, new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10), brass), HANDSET_REST.hook.position.x + dx, hookY + 0.012, 0.325);
  }

  // The handset: a bowed black handle with a brass band, a wide earpiece on top and a flared mouthpiece below.
  const handset = add(root, new THREE.Group());
  handset.position.copy(HANDSET_REST.hook.position);
  const bow = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -HANDSET_EAR_Y, 0.0), new THREE.Vector3(0, 0, -0.11), new THREE.Vector3(0, HANDSET_EAR_Y, 0.0));
  handset.add(new THREE.Mesh(new THREE.TubeGeometry(bow, 28, 0.037, 16), black));
  const band = add(handset, new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.007, 8, 24), brass), 0, 0, -0.055);
  band.rotation.x = Math.PI / 2;
  const lathe = (pts: number[][], mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r!, y!)), 40), mat);
    m.rotation.x = Math.PI / 2;
    return m;
  };
  for (const [y, wide] of [[HANDSET_EAR_Y, true], [-HANDSET_EAR_Y, false]] as const) {
    add(handset, new THREE.Mesh(new THREE.SphereGeometry(0.048, 20, 16), black), 0, y, 0);
    add(handset, new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.012, 10, 28), brass), 0, y, 0.03);
    const cup = wide
      ? lathe([[0.04, 0.0], [0.06, 0.035], [0.096, 0.07], [0.102, 0.085], [0.094, 0.096], [0.07, 0.09], [0.0, 0.082]], black)
      : lathe([[0.036, 0.0], [0.044, 0.045], [0.082, 0.105], [0.088, 0.12], [0.08, 0.122], [0.036, 0.06], [0.0, 0.05]], black);
    add(handset, cup, 0, y, 0.02);
    // The grille inside each cup.
    add(handset, disc(wide ? 0.066 : 0.03, 0.004, blackInside, 24), 0, y, wide ? 0.108 : 0.074);
  }
  add(handset, new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.07, 10), black), 0, HANDSET_CORD_Y + 0.03, 0);

  // The cord. Its geometry is rebuilt as the handset moves.
  const curve = new CoilCurve(30, 0.024);
  const cord = add(root, new THREE.Mesh(new THREE.BufferGeometry(), cordMat));
  const setCord = (end: THREE.Vector3) => {
    curve.a.copy(CORD_ROOT);
    curve.d.copy(end);
    const span = curve.a.distanceTo(end);
    const sag = 0.2 + 0.1 * Math.max(0, 1.4 - span);
    curve.b.copy(CORD_ROOT).add(new THREE.Vector3(-0.03, -sag, 0.06));
    curve.c.copy(end).add(new THREE.Vector3(0.04, -sag * 1.15, 0));
    curve.updateArcLengths();
    cord.geometry.dispose();
    cord.geometry = new THREE.TubeGeometry(curve, 420, 0.0075, 5, false);
  };
  setCord(new THREE.Vector3(0, HANDSET_CORD_Y, 0).add(HANDSET_REST.hook.position));
  add(root, new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), brassWorn), CORD_ROOT.x, CORD_ROOT.y, CORD_ROOT.z);

  // The waves and the ring strokes are flat shapes that face the viewer.
  const waves = [0, 1, 2].map(() => {
    const arc = Math.PI * 0.62;
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 6, 40, arc), waveMat());
    m.rotation.z = Math.PI - arc / 2;
    m.renderOrder = 5;
    return m;
  });
  const ticks = [0, 1, 2, 3, 4, 5].map(() => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.085), tickMat());
    m.renderOrder = 5;
    return m;
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const seen = new Set<THREE.Material>();
    for (const top of [root, ...waves, ...ticks]) {
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
    glow.dispose();
  };

  return { root, bells, clapper, wheel, handset, cord, lamp, lampGlow, aura, waves, ticks, setCord, dispose };
}
