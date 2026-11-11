// Prototype franki.html 1590-1727 (section 7: bolts, staples, the merged brass mesh) and 1990-1993 (the brass
// prepass, built after the fur as in the prototype), ported in WP5. Allowed edits E1, E3, and the merge failure
// as EngineError("merge"). Writes U.uBoltC (1696) and U.uHoles (1720); adds the two bolt lights to headInner.
// The `aPart` ids stay as numbered.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CharacterPart } from "./character";
import { BOLT_Y, DEG } from "./config";
import type { ConfigPart } from "./config";
import { EngineError } from "./errors";
import type { HairBrassMaterialsPart } from "./materials-hair-brass";
import { clamp, lerp } from "./math";
import type { SurfacePart } from "./surface";
import type { UniformsPart } from "./uniforms";

export interface Bolt {
  side: number;
  base: THREE.Vector3;
  axis: THREE.Vector3;
  tip: THREE.Vector3;
  rim: THREE.Vector3;
  light: THREE.PointLight;
  flash: number;
}

export interface BrassPart {
  bolts: Bolt[];
  BOLT_R: number;
  BOLT_L: number;
  STAPLE_ARC: number;
  STAPLE_R: number;
  STAPLE_TUBE: number;
  boltGeometry(): THREE.BufferGeometry;
  stapleGeometry(): THREE.BufferGeometry;
  scarAt(t: number): THREE.Vector2;
  brassGeo: THREE.BufferGeometry;
  brass: THREE.Mesh;
}

/** `finishPart`'s shade and part arguments: one number for the whole part, or a function of the vertex position. */
type PerVertex = number | ((x: number, y: number, z: number) => number);

export function createBrass(rc: ConfigPart & UniformsPart & HairBrassMaterialsPart & SurfacePart & CharacterPart): BrassPart {
  const { U, brassMat, surfaceAt, surfaceNormal, solveArc, arcOf, headInner } = rc;

  /* --- brass: bolts (washer, hex nut, threaded shaft, domed cap) and the three staples, one merged mesh --- */
  function roundedProfile(pts: THREE.Vector2[], rad: number, steps = 4) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], a = pts[i - 1], c = pts[i + 1];
      const da = a.clone().sub(p), dc = c.clone().sub(p);
      const ra = Math.min(rad, da.length() * 0.45), rc = Math.min(rad, dc.length() * 0.45);
      const p0 = p.clone().addScaledVector(da.normalize(), ra), p1 = p.clone().addScaledVector(dc.normalize(), rc);
      for (let k = 0; k <= steps; k++) {                           // quadratic Bezier with the corner as control
        const t = k / steps;
        out.push(new THREE.Vector2((1 - t) ** 2 * p0.x + 2 * t * (1 - t) * p.x + t * t * p1.x, (1 - t) ** 2 * p0.y + 2 * t * (1 - t) * p.y + t * t * p1.y));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  const v2 = (x: number, y: number) => new THREE.Vector2(x, y);
  function finishPart(geo: THREE.BufferGeometry, shade: PerVertex, part: PerVertex) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), prt = new Float32Array(n);
    const p = g.attributes.position;
    for (let i = 0; i < n; i++) {
      const s = typeof shade === 'function' ? shade(p.getX(i), p.getY(i), p.getZ(i)) : shade;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
      prt[i] = typeof part === 'function' ? part(p.getX(i), p.getY(i), p.getZ(i)) : part;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(prt, 1));
    return g;
  }
  function threadedShaft() {
    const segs = 48, rows = 84, y0 = 0.052, y1 = 0.156, turns = 7, verts = [] as number[], uvs = [] as number[], idx = [] as number[];
    const crestAt = (y: number, ph: number) => {                                     // 0 in the thread root, 1 on the crest of the helix
      const f = (((turns * (y - y0)) / (y1 - y0) - ph / (2 * Math.PI)) % 1 + 1) % 1;
      return Math.pow(1 - Math.abs(2 * f - 1), 1.4);
    };
    for (let i = 0; i <= rows; i++) {
      const y = lerp(y0, y1, i / rows);
      for (let j = 0; j <= segs; j++) {
        const ph = (j / segs) * 2 * Math.PI, r = 0.038 + 0.004 * crestAt(y, ph);
        verts.push(r * Math.sin(ph), y, r * Math.cos(ph));
        uvs.push(j / segs, y * 12);
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nrm = g.attributes.normal;                                 // weld the seam normals
    for (let i = 0; i <= rows; i++) {
      const a = i * (segs + 1), b = a + segs;
      const nx = nrm.getX(a) + nrm.getX(b), ny = nrm.getY(a) + nrm.getY(b), nz = nrm.getZ(a) + nrm.getZ(b), l = Math.hypot(nx, ny, nz) || 1;
      nrm.setXYZ(a, nx / l, ny / l, nz / l); nrm.setXYZ(b, nx / l, ny / l, nz / l);
    }
    return finishPart(g, (x, y, z) => 0.34 + 0.3 * crestAt(y, Math.atan2(x, z)), 2);   // crests catch a little light, roots stay dark: a shaft, not a filament
  }
  function boltGeometry() {
    const washer = new THREE.LatheGeometry(roundedProfile([v2(0.083, -0.014), v2(0.085, 0.002), v2(0.085, 0.012), v2(0.046, 0.012), v2(0.046, -0.014)], 0.003), 64);
    const hex = new THREE.Shape();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; const R = 0.075 - 0.006; i ? hex.lineTo(R * Math.cos(a), R * Math.sin(a)) : hex.moveTo(R * Math.cos(a), R * Math.sin(a)); }
    hex.closePath();
    const nut = new THREE.ExtrudeGeometry(hex, { depth: 0.038, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 1 });
    nut.rotateX(-Math.PI / 2); nut.translate(0, 0.018, 0);
    const cap = new THREE.LatheGeometry(roundedProfile([v2(0.036, 0.086), v2(0.105, 0.086), v2(0.105, 0.184), v2(0.07, 0.1905), v2(0.0005, 0.1925)], 0.012, 5), 96);   // a deep cap, as in the art; only a sliver of thread shows above the nut
    return mergeGeometries([
      finishPart(washer, (x, y, z) => (Math.hypot(x, z) > 0.08 ? 0.62 : 0.5), 0),
      finishPart(nut, (x, y) => (y < 0.024 || y > 0.056 ? 0.62 : 0.78), 1),
      threadedShaft(),
      finishPart(cap, (x, y) => (y < 0.089 ? 0.55 : 1), (x, y, z) => (Math.hypot(x, z) > 0.095 && y > 0.088 ? 3.5 : 3)),
    ]);
  }
  const STAPLE_ARC = Math.PI * 0.85, STAPLE_R = 0.05, STAPLE_TUBE = 0.0155;   // chunky pill-shaped staples, as in the art
  function stapleGeometry() {
    const arc = STAPLE_ARC;
    const g = new THREE.TorusGeometry(STAPLE_R, STAPLE_TUBE, 16, 36, arc);
    g.rotateZ(Math.PI / 2 - arc / 2);                               // arc symmetric about +Y (the skin normal)
    return finishPart(g, 0.9, 4);
  }

  const bolts = [] as Bolt[];
  const brassParts = [] as THREE.BufferGeometry[];
  const BOLT_R = 1.25, BOLT_L = 1.15;                                // the art's bolts: cap about as wide as an eye is tall, standing well proud
  const boltLocal = boltGeometry();
  for (let s = -1; s <= 1; s += 2) {
    const th = s * Math.PI / 2;
    const P = surfaceAt(th, BOLT_Y), N = surfaceNormal(th, BOLT_Y);
    N.y = 0; N.normalize();                                         // straight out of the temple, whatever the head's slope there
    const axis = N.clone().add(new THREE.Vector3(0, -Math.tan(4 * DEG), -Math.tan(6 * DEG))).normalize();   // 4 deg down, 6 deg back
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    const base = P.clone().addScaledVector(axis, -0.012);
    brassParts.push(boltLocal.clone().applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(BOLT_R, BOLT_L, BOLT_R))));
    const perp = new THREE.Vector3(0, 1, 0).applyQuaternion(q).cross(new THREE.Vector3(0, 0, 1)).normalize();
    const tip = base.clone().addScaledVector(axis, 0.1925 * BOLT_L);
    const light = new THREE.PointLight(0xFFD24D, 0, 1.4, 2);
    light.position.copy(tip).addScaledVector(axis, 0.14);
    headInner.add(light);
    bolts.push({ side: s, base, axis, tip, rim: tip.clone().addScaledVector(axis, -0.04).addScaledVector(perp, 0.1 * BOLT_R), light, flash: 0 });
  }
  bolts.forEach((b, i) => U.uBoltC.value[i].copy(b.base));

  /* Scar staples: placed across the cut at 75 degrees; their leg holes feed the skin shader. */
  const scarAt = (t: number) => {
    const A = U.uScarA.value, B = U.uScarB.value, Cc = U.uScarC.value;
    return new THREE.Vector2((1 - t) ** 2 * A.x + 2 * t * (1 - t) * B.x + t * t * Cc.x, (1 - t) ** 2 * A.y + 2 * t * (1 - t) * B.y + t * t * Cc.y);
  };
  const stapleLocal = stapleGeometry();
  [0.22, 0.52, 0.82].forEach((t, i) => {
    const a = scarAt(t), a2 = scarAt(t + 0.01);
    const s1 = solveArc(a.x, a.y), s2 = solveArc(a2.x, a2.y);
    const P = surfaceAt(s1.th, s1.y), N = surfaceNormal(s1.th, s1.y);
    const T = surfaceAt(s2.th, s2.y).sub(P);
    T.addScaledVector(N, -T.dot(N)).normalize();
    const B = new THREE.Vector3().crossVectors(N, T);
    const across = T.clone().multiplyScalar(Math.cos(75 * DEG)).addScaledVector(B, Math.sin(75 * DEG)).normalize();
    const Z = new THREE.Vector3().crossVectors(across, N).normalize();
    const m = new THREE.Matrix4().makeBasis(across, N, Z);
    const arc = STAPLE_ARC, R = STAPLE_R;
    const sink = R * Math.cos(arc / 2) + 0.021;                   // sunk so the crown sits low over the cut, like a real staple
    m.setPosition(P.clone().addScaledVector(N, -sink));
    brassParts.push(stapleLocal.clone().applyMatrix4(m));
    const legX = R * Math.sin(Math.acos(clamp(sink / R, -1, 1)));    // where each leg enters the skin
    const legA = P.clone().addScaledVector(across, legX), legB = P.clone().addScaledVector(across, -legX);
    U.uHoles.value[i * 2].copy(arcOf(legA)); U.uHoles.value[i * 2 + 1].copy(arcOf(legB));
  });
  const brassGeo = mergeGeometries(brassParts);
  if (!brassGeo) throw new EngineError('merge', 'brass geometry merge failed');   // contract: the named failure, as EngineError("merge")
  const brass = new THREE.Mesh(brassGeo, brassMat);
  brass.castShadow = true; brass.receiveShadow = true;
  brass.renderOrder = 13;
  headInner.add(brass);

  return { bolts, BOLT_R, BOLT_L, STAPLE_ARC, STAPLE_R, STAPLE_TUBE, boltGeometry, stapleGeometry, scarAt, brassGeo, brass };
}

export interface BrassPrePart {
  brassPreMat: THREE.MeshBasicMaterial;
  brassPre: THREE.Mesh;
}

/** 1990-1993: built after the fur, as in the prototype. */
export function createBrassPre(rc: CharacterPart & BrassPart): BrassPrePart {
  const { headInner, brassGeo } = rc;

  const brassPreMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const brassPre = new THREE.Mesh(brassGeo, brassPreMat);
  brassPre.renderOrder = 12.5; brassPre.visible = false;
  headInner.add(brassPre);

  return { brassPreMat, brassPre };
}
