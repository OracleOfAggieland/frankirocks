import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ARC_BOLTS, ARC_SEGMENTS, ARM, BEZEL, CAB, DIAL, FRONT_Z, KNOB, SCREEN, SHOULDER, TOP_Y, armAngles, buildXray, handBones, handFilm } from "./model";

const topOf = (o: THREE.Object3D) => {
  let top = o;
  while (top.parent !== null) top = top.parent;
  return top;
};

const meshBox = (root: THREE.Object3D) => {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) box.expandByObject(mesh);
  });
  return box;
};

describe("buildXray", () => {
  it("builds every moving part with no WebGL, all inside the root", () => {
    const m = buildXray();
    expect(m.arcs).toHaveLength(ARC_BOLTS * ARC_SEGMENTS);
    for (const part of [m.glass, m.bones, m.scanLine, m.screenGlow, m.dialFace, m.needle, m.knob, m.filament, m.valveGlow, m.shoulder, m.elbow, m.head, m.aperture, m.apertureGlow, m.arcGroup, m.arcGlow, m.beam, m.shadow, ...m.arcs]) {
      expect(topOf(part)).toBe(m.root);
    }
    // The head hangs at the end of the arm, and the arc is on the head.
    expect(topOf(m.head)).toBe(m.root);
    let p: THREE.Object3D | null = m.head;
    while (p !== null && p !== m.elbow) p = p.parent;
    expect(p).toBe(m.elbow);
    expect(m.arcGroup.parent).toBe(m.head);
    m.dispose();
  });

  it("lays the front out as a fluoroscope: a big glass in a bezel, a dial and a knob under it", () => {
    // The glass is the biggest thing on the front: more than half the cabinet's width and nearly half its height.
    expect(SCREEN.w).toBeGreaterThan(CAB.halfW);
    expect(SCREEN.h).toBeGreaterThan((CAB.top - CAB.bottom) * 0.45);
    // The bezel sits inside the cabinet's front, and the dial and the knob below it.
    expect(SCREEN.y + SCREEN.h / 2 + BEZEL).toBeLessThan(CAB.top);
    expect(SCREEN.w / 2 + BEZEL).toBeLessThan(CAB.halfW);
    expect(DIAL.y + DIAL.r).toBeLessThan(SCREEN.y - SCREEN.h / 2 - BEZEL);
    expect(DIAL.x).toBeLessThan(0);
    expect(KNOB.x).toBeGreaterThan(0);
    // The arm stands on the top's right, away from Franki, who floats at the machine's upper left.
    expect(SHOULDER.x).toBeGreaterThan(0);
    expect(SHOULDER.y).toBeGreaterThan(TOP_Y);
  });

  it("swings the head from high up to in front of the glass, and aims it there", () => {
    const m = buildXray();
    const at = (aim: number) => {
      const a = armAngles(aim);
      m.shoulder.rotation.x = a.shoulder;
      m.elbow.rotation.x = a.elbow;
      m.root.updateMatrixWorld(true);
      return m.head.getWorldPosition(new THREE.Vector3());
    };
    const parked = at(0);
    const aimed = at(1);
    expect(parked.y).toBeGreaterThan(aimed.y + 0.2);
    // Aimed, the head is in front of the glass, above the cabinet and off to its right.
    expect(aimed.z).toBeGreaterThan(FRONT_Z);
    expect(aimed.y).toBeGreaterThan(TOP_Y);
    expect(aimed.x).toBeGreaterThan(SCREEN.w / 2);
    // In between, the joints move smoothly from one pose to the other.
    expect(armAngles(0.5).elbow).toBeCloseTo((ARM.parked.elbow + ARM.aimed.elbow) / 2, 9);
    expect(armAngles(-3)).toEqual(armAngles(0));
    expect(armAngles(9)).toEqual(armAngles(1));
    m.dispose();
  });

  it("stands on the floor, its front facing the camera, and fits a square canvas in either arm pose", () => {
    const m = buildXray();
    for (const aim of [0, 1]) {
      const a = armAngles(aim);
      m.shoulder.rotation.x = a.shoulder;
      m.elbow.rotation.x = a.elbow;
      const box = meshBox(m.root);
      expect(box.min.y).toBeGreaterThan(-0.01);
      expect(box.min.y).toBeLessThan(0.01);
      // The engine's camera sees about 1.95 units across at the machine; everything stays inside it.
      expect(box.max.y - box.min.y).toBeLessThan(1.8);
      expect(box.max.x - box.min.x).toBeLessThan(1.8);
    }
    expect(m.glass.position.z).toBeGreaterThan(FRONT_Z);
    expect(m.bones.position.z).toBeGreaterThan(m.glass.position.z);
    m.dispose();
  });

  it("frees every geometry, material and texture, and can be disposed twice", () => {
    const m = buildXray();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    m.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) geometries.add(mesh.geometry);
      const mat = (o as THREE.Mesh | THREE.Sprite).material as THREE.Material | undefined;
      if (mat === undefined) return;
      materials.add(mat);
      for (const key of ["map", "emissiveMap"] as const) {
        const map = (mat as THREE.MeshStandardMaterial)[key];
        if (map) textures.add(map);
      }
    });
    expect(geometries.size).toBeGreaterThan(40);
    expect(textures.size).toBeGreaterThanOrEqual(7);
    const freed = new Set<object>();
    for (const x of [...geometries, ...materials, ...textures]) x.addEventListener("dispose", () => freed.add(x));
    m.dispose();
    for (const g of geometries) expect(freed.has(g)).toBe(true);
    for (const mat of materials) expect(freed.has(mat)).toBe(true);
    for (const t of textures) expect(freed.has(t)).toBe(true);
    const before = freed.size;
    expect(() => m.dispose()).not.toThrow();
    expect(freed.size).toBe(before);
  });
});

describe("the film on the glass", () => {
  const film = handFilm();
  const FILM_ASPECT = 128 / 144;
  /** The film's (u, v) for a point in the bones' own units. */
  const uvOf = (x: number, y: number): [number, number] => [(x - (1 - FILM_ASPECT) / 2) / FILM_ASPECT, y];

  it("draws a hand: five rays of bones, three to a finger and two to the thumb, and the wrist's small bones", () => {
    const { bones, carpals } = handBones();
    // Two forearm bones, five long hand bones, 3 × 4 finger bones and 2 for the thumb.
    expect(bones).toHaveLength(2 + 5 + 12 + 2);
    expect(carpals.length).toBeGreaterThanOrEqual(7);
    // The fingers point up the glass, and all of it fits on the film.
    for (const b of bones.slice(2)) {
      expect(b.by).toBeLessThan(b.ay);
      expect(b.by).toBeGreaterThan(0);
    }
  });

  it("is bright on the bones, brightest on their edges and the ring, faint on the flesh and dark around the hand", () => {
    const { bones, ring } = handBones();
    const middle = bones[2 + 5 + 3]!; // the middle finger's first bone
    const [cu, cv] = uvOf((middle.ax + middle.bx) / 2, (middle.ay + middle.by) / 2);
    const boneValue = film(cu, cv);
    expect(boneValue).toBeGreaterThan(0.55);
    // Just inside the bone's edge is brighter than its middle, as the hard outer bone shows on film.
    const nx = -(middle.by - middle.ay), ny = middle.bx - middle.ax;
    const n = Math.hypot(nx, ny);
    const [eu, ev] = uvOf((middle.ax + middle.bx) / 2 + (nx / n) * middle.r * 0.75, (middle.ay + middle.by) / 2 + (ny / n) * middle.r * 0.75);
    expect(film(eu, ev)).toBeGreaterThan(boneValue);
    // Between two fingers' long bones is flesh.
    const [fu, fv] = uvOf(0.455, 0.55);
    const flesh = film(fu, fv);
    expect(flesh).toBeGreaterThan(0.08);
    expect(flesh).toBeLessThan(0.3);
    // The corners are empty film.
    for (const [u, v] of [[0.02, 0.02], [0.98, 0.02], [0.02, 0.3], [0.98, 0.3]] as const) expect(film(u, v)).toBeLessThan(0.02);
    // The ring is solid metal: the brightest thing there is.
    const [ru, rv] = uvOf((ring.ax + ring.bx) / 2, (ring.ay + ring.by) / 2);
    expect(film(ru, rv)).toBeGreaterThan(0.97);
  });

  it("stays between 0 and 1 everywhere", () => {
    for (let y = 0; y <= 1; y += 1 / 37) {
      for (let x = 0; x <= 1; x += 1 / 31) {
        const v = film(x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
