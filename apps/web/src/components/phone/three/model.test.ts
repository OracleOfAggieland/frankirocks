import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CORD_ROOT, HANDSET_CORD_Y, HANDSET_REST, WHEEL_HOLES, WHEEL_HOLE_RING, buildPhone, holeAngle } from "./model";

describe("buildPhone", () => {
  it("builds every moving part, with no WebGL", () => {
    const m = buildPhone();
    expect(m.bells).toHaveLength(2);
    expect(m.waves).toHaveLength(3);
    expect(m.ticks).toHaveLength(6);
    for (const part of [m.clapper, m.wheel, m.handset, m.cord, m.lamp, m.lampGlow, ...m.bells]) {
      let top: THREE.Object3D = part;
      while (top.parent !== null) top = top.parent;
      expect(top).toBe(m.root);
    }
    // The waves and ring strokes face the viewer whatever way the phone is turned, so they stay out of the root.
    for (const flat of [...m.waves, ...m.ticks]) expect(flat.parent).toBeNull();
    m.dispose();
  });

  it("hangs the handset on its hook to start, left of the cabinet", () => {
    const m = buildPhone();
    expect(m.handset.position.equals(HANDSET_REST.hook.position)).toBe(true);
    expect(HANDSET_REST.hook.position.x).toBeLessThan(-0.37 - 0.1);
    // At the ear it has moved toward the ghost, who stands to the left.
    expect(HANDSET_REST.ear.position.x).toBeLessThan(HANDSET_REST.hook.position.x);
    m.dispose();
  });

  it("puts ten holes on one circle and leaves the finger stop's side clear", () => {
    expect(WHEEL_HOLES).toBe(10);
    const angles = Array.from({ length: WHEEL_HOLES }, (_, i) => Math.round(THREE.MathUtils.radToDeg(holeAngle(i))));
    expect(new Set(angles).size).toBe(10);
    // From 210 to 300 degrees (the lower right, by the stop) is the gap.
    expect(angles.filter((a) => a > 210 && a < 300)).toEqual([]);
    const m = buildPhone();
    m.wheel.geometry.computeBoundingSphere();
    expect(m.wheel.geometry.boundingSphere!.radius).toBeGreaterThan(WHEEL_HOLE_RING + 0.03);
    m.dispose();
  });

  it("runs the cord from the cabinet to the handset's lower end, wherever the handset is", () => {
    const m = buildPhone();
    for (const end of [
      new THREE.Vector3(0, HANDSET_CORD_Y, 0).add(HANDSET_REST.hook.position),
      new THREE.Vector3(0, HANDSET_CORD_Y, 0).applyEuler(HANDSET_REST.ear.rotation).add(HANDSET_REST.ear.position),
    ]) {
      m.setCord(end);
      const pos = m.cord.geometry.getAttribute("position");
      const nearest = (p: THREE.Vector3) => {
        let best = Infinity;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) best = Math.min(best, v.fromBufferAttribute(pos, i).distanceTo(p));
        return best;
      };
      // The coil closes at both ends, so the tube's wall (0.0075 thick) touches each anchor.
      expect(nearest(CORD_ROOT)).toBeLessThan(0.012);
      expect(nearest(end)).toBeLessThan(0.012);
      for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
    }
    m.dispose();
  });

  it("frees its geometry and can be disposed twice", () => {
    const m = buildPhone();
    let freed = 0;
    m.cord.geometry.addEventListener("dispose", () => freed++);
    m.dispose();
    expect(freed).toBe(1);
    expect(() => m.dispose()).not.toThrow();
  });
});
