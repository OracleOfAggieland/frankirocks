import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ANTENNA_BASE, ANTENNA_TIP, ARC_BOLTS, ARC_SEGMENTS, CAB_HALF_W, DIAL, DRIFTERS, FRONT_Z, KNOB_Y, SPEAKER, buildRadio } from "./model";

const topOf = (o: THREE.Object3D) => {
  let top = o;
  while (top.parent !== null) top = top.parent;
  return top;
};

describe("buildRadio", () => {
  it("builds every moving part with no WebGL, all inside the root but the drifters", () => {
    const m = buildRadio();
    expect(m.knobs).toHaveLength(2);
    expect(m.arcs).toHaveLength(ARC_BOLTS * ARC_SEGMENTS);
    expect(m.drifters).toHaveLength(DRIFTERS);
    for (const part of [m.speaker, m.dialFace, m.dialGlow, m.needle, m.tip, m.tipGlow, m.arcGroup, m.sourceGlow, m.shadow, ...m.knobs, ...m.arcs]) {
      expect(topOf(part)).toBe(m.root);
    }
    // The rings and the note rise straight up whichever way the radio is turned, so they stay out of the root.
    for (const d of m.drifters) expect(d.parent).toBeNull();
    m.dispose();
  });

  it("lays the front out as a radio: speaker on top, dial below it, knobs under the dial", () => {
    expect(SPEAKER.y - SPEAKER.r).toBeGreaterThan(DIAL.y + DIAL.h / 2);
    expect(DIAL.y - DIAL.h / 2).toBeGreaterThan(KNOB_Y);
    // The speaker is the biggest thing on the front: more than half the cabinet's width across.
    expect(SPEAKER.r * 2).toBeGreaterThan(CAB_HALF_W);
    expect(DIAL.reach * 2).toBeLessThan(DIAL.w);
    // The antenna leans out to the left, away from Franki, and ends above the cabinet.
    expect(ANTENNA_TIP.x).toBeLessThan(ANTENNA_BASE.x);
    expect(ANTENNA_TIP.y).toBeGreaterThan(ANTENNA_BASE.y + 0.3);
  });

  it("stands on the floor, with its front facing the camera", () => {
    const m = buildRadio();
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    m.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) box.expandByObject(mesh);
    });
    expect(box.min.y).toBeGreaterThan(-0.01);
    expect(box.min.y).toBeLessThan(0.01);
    expect(m.dialFace.position.z).toBeGreaterThan(FRONT_Z);
    expect(Math.abs(box.max.x + box.min.x)).toBeLessThan(0.4);
    m.dispose();
  });

  it("frees every geometry, material and texture, and can be disposed twice", () => {
    const m = buildRadio();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const top of [m.root, ...m.drifters]) {
      top.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) geometries.add(mesh.geometry);
        const mat = (o as THREE.Mesh | THREE.Sprite).material as THREE.Material | undefined;
        if (mat === undefined) return;
        materials.add(mat);
        const map = (mat as THREE.MeshStandardMaterial).map;
        if (map) textures.add(map);
      });
    }
    expect(geometries.size).toBeGreaterThan(20);
    expect(textures.size).toBeGreaterThanOrEqual(3);
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
