// One hand's bones on the screen (brief 051 part C): the finger and palm bones, the eight wrist bones and the two
// forearm bones, each an instance of one code-built bone, placed every frame by the rig. Three draws a hand.
import * as THREE from "three";
import type { Vec3 } from "./bone-place";
import { type HandRig, FINGER_BONES, KNUCKLES } from "./hand-rig";
import { boneMaterial, setOpacity } from "./material";
import { emptyPart, lathe, ovoid, toGeometry } from "./shapes";

/** A long bone standing on +y from 0 to 1, 1 wide: a base that cups the joint below, a waisted shaft, a round head. */
export function boneGeometry(): THREE.BufferGeometry {
  const p = emptyPart();
  lathe(p, [
    { y: 0.03, r: 0, d: 1.15 }, { y: 0.036, r: 0.3, d: 1.15 }, { y: 0.065, r: 0.47, d: 1.1 }, { y: 0.115, r: 0.5, d: 1.05 },
    { y: 0.21, r: 0.4, d: 1 }, { y: 0.35, r: 0.31, d: 1 }, { y: 0.64, r: 0.29, d: 1 }, { y: 0.79, r: 0.34, d: 1 },
    { y: 0.895, r: 0.42, d: 1.05 }, { y: 0.95, r: 0.37, d: 1.1 }, { y: 0.972, r: 0, d: 1.1 },
  ], 12);
  return toGeometry(p);
}

/** A forearm bone: its end at the wrist, then a shaft that fades to nothing along its length. */
export function forearmGeometry(): THREE.BufferGeometry {
  const p = emptyPart();
  const steps = [0, 0.012, 0.05, 0.14, 0.3, 0.5, 0.7, 0.85, 1];
  const r = [0, 0.4, 0.5, 0.38, 0.33, 0.32, 0.32, 0.33, 0.33];
  lathe(p, steps.map((y, i) => ({ y, r: r[i]!, d: Math.max(0, 1 - y) ** 1.4 })), 12);
  return toGeometry(p);
}

const BONES = FINGER_BONES.length + KNUCKLES.length;
const WRIST = 8;

export interface HandModel {
  readonly root: THREE.Group;
  update(rig: HandRig): void;
  setOpacity(opacity: number): void;
  dispose(): void;
}

export function buildHand(): HandModel {
  const root = new THREE.Group();
  const material = boneMaterial({ gain: 0.85, base: 0.09, ortho: true, instanced: true });
  const boneGeo = boneGeometry();
  const armGeo = forearmGeometry();
  const wristPart = emptyPart();
  ovoid(wristPart, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, 1, { x: 0, y: 0, z: 0 }, 12);
  const wristGeo = toGeometry(wristPart);
  const bones = new THREE.InstancedMesh(boneGeo, material, BONES);
  const arm = new THREE.InstancedMesh(armGeo, material, 2);
  const wrist = new THREE.InstancedMesh(wristGeo, material, WRIST);
  for (const m of [bones, arm, wrist]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(m);
  }
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const at = (v: Vec3) => pos.set(v.x, v.y, v.z);

  return {
    root,
    update(rig) {
      rig.bones.forEach((b, i) => {
        quat.set(...b.place.quat);
        // A bone of length 0 is drawn as a dot, never stretched to nothing on its width alone.
        mat.compose(at(b.place.origin), quat, scl.set(b.thickness, Math.max(b.place.length, 1e-6), b.thickness));
        bones.setMatrixAt(i, mat);
      });
      rig.forearm.forEach((b, i) => {
        quat.set(...b.place.quat);
        mat.compose(at(b.place.origin), quat, scl.set(b.thickness, Math.max(b.place.length, 1e-6), b.thickness));
        arm.setMatrixAt(i, mat);
      });
      quat.set(...rig.palm.quat);
      rig.wrist.forEach((w, i) => {
        mat.compose(at(w.at), quat, scl.set(w.radius * 1.1, w.radius * 0.9, w.radius * 0.75));
        wrist.setMatrixAt(i, mat);
      });
      bones.instanceMatrix.needsUpdate = true;
      arm.instanceMatrix.needsUpdate = true;
      wrist.instanceMatrix.needsUpdate = true;
    },
    setOpacity(opacity) {
      setOpacity(material, opacity);
      root.visible = opacity > 0.001;
    },
    dispose() {
      for (const g of [boneGeo, armGeo, wristGeo]) g.dispose();
      material.dispose();
      for (const m of [bones, arm, wrist]) m.dispose();
    },
  };
}
