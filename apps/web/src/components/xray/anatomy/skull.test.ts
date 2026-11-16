import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CANONICAL } from "./canonical";
import { buildHand, boneGeometry, forearmGeometry } from "./hand";
import { handRig } from "./hand-rig";
import { apertureHalfWidth, browY, craniumAlong, craniumFrontZ, LOWER_ARCH, LOWER_TEETH, orbitRim, teethAlong, UPPER_ARCH, UPPER_TEETH } from "./skull-shape";
import { buildSkull, FRANKI_MARKS } from "./skull";

const boxOf = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
};

function everyAttributeFinite(o: THREE.Object3D) {
  let count = 0;
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    const g = m.geometry as THREE.BufferGeometry;
    for (const name of ["position", "normal", "aDensity"]) {
      const a = g.getAttribute(name);
      expect(a, name).toBeDefined();
      for (let i = 0; i < a.array.length; i++) expect(Number.isFinite(a.array[i]!)).toBe(true);
    }
    const index = g.getIndex()!;
    const verts = g.getAttribute("position").count;
    for (let i = 0; i < index.count; i++) expect(index.getX(i)).toBeLessThan(verts);
    count += verts;
  });
  return count;
}

describe("the skull's measurements", () => {
  it("sit the bone under the canonical head's skin", () => {
    // The forehead: bone about half a centimetre under the skin.
    const z = craniumFrontZ(0, CANONICAL.forehead.y)!;
    expect(CANONICAL.forehead.z - z).toBeGreaterThan(0.2);
    expect(CANONICAL.forehead.z - z).toBeLessThan(1.2);
    // The top of the head about 22 cm above the chin, the back about 18 cm behind the brow.
    expect(craniumAlong({ x: 0, y: 1, z: 0 }).y - CANONICAL.chin.y).toBeGreaterThan(21);
    expect(CANONICAL.nasion.z - craniumAlong({ x: 0, y: 0, z: -1 }).z).toBeGreaterThan(17);
    // Narrower than the face at the ears.
    expect(craniumAlong({ x: 1, y: 0, z: 0 }).x).toBeLessThan(CANONICAL.leftSide.x);
  });

  it("put each eye socket round its eye corners, and the nose's opening under the nose", () => {
    const rim = Array.from({ length: 40 }, (_, i) => orbitRim((i / 40) * Math.PI * 2));
    const xs = rim.map((p) => p.x);
    const ys = rim.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThan(CANONICAL.leftEyeInner.x);
    expect(Math.max(...xs)).toBeGreaterThan(CANONICAL.leftEyeOuter.x);
    expect(Math.min(...ys)).toBeLessThan(CANONICAL.leftEyeOuter.y);
    expect(Math.max(...ys)).toBeGreaterThan(CANONICAL.leftEyeOuter.y);
    expect(Math.max(...ys)).toBeLessThan(browY(3.2) + 0.1);
    expect(apertureHalfWidth(-1)).toBeGreaterThan(apertureHalfWidth(0.9));
    expect(apertureHalfWidth(-1) * 2).toBeLessThan(CANONICAL.leftMouth.x * 2);
  });

  it("space the teeth along the arch in order, the upper row's edge below the lower's", () => {
    for (const [arch, kinds] of [[UPPER_ARCH, UPPER_TEETH], [LOWER_ARCH, LOWER_TEETH]] as const) {
      const row = teethAlong(arch, kinds);
      expect(row).toHaveLength(8);
      for (let i = 1; i < row.length; i++) expect(row[i]!.phi).toBeGreaterThan(row[i - 1]!.phi);
    }
    expect(UPPER_ARCH.edgeY).toBeLessThan(LOWER_ARCH.edgeY);
    expect(UPPER_ARCH.edgeY).toBeGreaterThan(CANONICAL.lowerLip.y - 0.3);
  });
});

describe("the skull model", () => {
  it("is all finite, every triangle on a real vertex, and sized to the canonical head", () => {
    const skull = buildSkull();
    expect(everyAttributeFinite(skull.root)).toBeGreaterThan(10000);
    const box = boxOf(skull.root);
    // Inside the head: narrower than the face at the ears (bolts aside), short of the nose's tip.
    expect(box.max.z).toBeLessThan(CANONICAL.noseTip.z - 1);
    expect(box.max.y).toBeLessThan(CANONICAL.forehead.y + 6);
    // The neck bones go on below the chin, and stop well above the shoulders.
    expect(box.min.y).toBeLessThan(CANONICAL.chin.y - 3);
    expect(box.min.y).toBeGreaterThan(CANONICAL.chin.y - 8.5);
    skull.dispose();
  });

  it("swings the jaw down on its hinge", () => {
    const skull = buildSkull();
    const jaw = skull.root.children.find((c) => c instanceof THREE.Group)!;
    const shut = boxOf(jaw);
    skull.setJaw(1);
    const open = boxOf(jaw);
    expect(open.min.y).toBeLessThan(shut.min.y - 0.5);
    skull.setJaw(Number.NaN);
    expect(jaw.rotation.x).toBe(0);
    skull.dispose();
  });

  it("carries Franki's bolts and seam as metal, and drops them when asked", () => {
    expect(FRANKI_MARKS).toBe(true);
    const metals = (s: ReturnType<typeof buildSkull>) => {
      let n = 0;
      s.root.traverse((o) => {
        if (o instanceof THREE.Mesh && (o.material as THREE.ShaderMaterial).blending === THREE.NormalBlending) n++;
      });
      return n;
    };
    const marked = buildSkull(true);
    const plain = buildSkull(false);
    expect(metals(marked)).toBe(1);
    expect(metals(plain)).toBe(0);
    // Two bolts below the chin's level, behind the teeth, sticking out each side, with the neck between them.
    const metal = marked.root.children.find((o) => o instanceof THREE.Mesh && (o.material as THREE.ShaderMaterial).blending === THREE.NormalBlending) as THREE.Mesh;
    const pos = metal.geometry.getAttribute("position");
    let lowest = Infinity;
    let widest = 0;
    let gap = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      if (y > 0) continue; // the seam on the brow
      expect(y).toBeLessThan(CANONICAL.chin.y - 2);
      expect(z).toBeLessThan(0);
      lowest = Math.min(lowest, y);
      widest = Math.max(widest, Math.abs(x));
      gap = Math.min(gap, Math.abs(x));
    }
    expect(widest).toBeGreaterThan(5);
    expect(gap).toBeGreaterThan(1.5);
    expect(lowest).toBeGreaterThan(CANONICAL.chin.y - 4);
    marked.dispose();
    plain.dispose();
  });

  it("fades out together and hides once gone", () => {
    const skull = buildSkull();
    skull.setOpacity(0.5);
    skull.root.traverse((o) => {
      if (o instanceof THREE.Mesh) expect((o.material as THREE.ShaderMaterial).uniforms.uOpacity!.value).toBe(0.5);
    });
    skull.setOpacity(0);
    expect(skull.root.visible).toBe(false);
    skull.dispose();
  });
});

describe("the hand model", () => {
  it("builds finite bones that stand on +y from 0 to 1", () => {
    for (const g of [boneGeometry(), forearmGeometry()]) {
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
      expect(g.boundingBox!.max.y).toBeLessThanOrEqual(1);
      g.dispose();
    }
  });

  it("places 19 bones, 2 forearm bones and 8 wrist bones from a rig", () => {
    const hand = buildHand();
    const pts = Array.from({ length: 21 }, (_, i) => ({ x: (i % 5) * 0.02, y: Math.floor(i / 5) * 0.03, z: 0 }));
    hand.update(handRig(pts));
    const counts = hand.root.children.map((c) => (c as THREE.InstancedMesh).count);
    expect(counts).toEqual([19, 2, 8]);
    for (const c of hand.root.children) {
      const arr = (c as THREE.InstancedMesh).instanceMatrix.array;
      for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i]!)).toBe(true);
    }
    hand.dispose();
  });
});
