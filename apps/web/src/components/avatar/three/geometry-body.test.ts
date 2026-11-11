// WP4: the profile, the surface math, the body geometry, the scene graph and the eyes (franki.html 1423-1588).
// Real factories, dummy materials, no renderer. The goldens are literals produced by evaluating the prototype's own
// text for those lines (plus config 217-222, utils 227-234 and BEAD_LID at 1170) in node with three@0.187.0 and the
// same dummy materials. A verbatim port reproduces them exactly, so every number is compared for equality.
import { createHash } from "node:crypto";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCharacter } from "./character";
import { createSurface } from "./surface";

const GOLDEN = {
  calls: ["bead-1", "lid-1", "bead1", "lid1"],
  DENSE_MAX: 810,
  EYE_TH: 0.24894003952426305,
  DENSE_len: 2401,
  PROFILE_len: 200,
  PROFILE0: [0.001, 0.12, 0],
  PROFILE199: [0.0010000000000000009, 1.7999999999999998, 0],
  DENSE_at_max: [0.7577168970033094, 0.36447685588390627, 0],
  profileRAtY: [0.7519999220524035, 0.6900000514496473, 0.6690886357513169, 0.6203696596038867, 0.14514523403681506, 0.001],
  solveXY: [
    { th: 0.25689321507510243, y: 1.19 },
    { th: -0.2568932150749546, y: 1.19 },
    { th: 0, y: 0.86 },
    { th: 0.5047431589059937, y: 1.5 },
  ],
  solveArc: [
    { th: 0.14931694728464642, y: 1.2 },
    { th: -0.36231884057971403, y: 0.9 },
    { th: 0, y: 1.6 },
  ],
  surfaceAt: [
    [0.20390895780079643, 1, 0.5668967150189272],
    [0.45975877711066293, 0.09188845993025345, -0.5404809310821322],
  ],
  surfaceAtSockets: [0.16256633006602902, 1.19, 0.5632334279771894],
  surfaceNormal: [0.2555640488307082, 0.10870163690494905, 0.960661736033782],
  arcOf: [0.2286105518099344, 1.1],
  body: {
    vertices: 31682,
    indices: 190080,
    indexType: "Uint16Array",
    posSha: "925175229f723f703cbc2fe5a205c32c92c7eea97c0410f37097eca15ee4b76b",
    idxSha: "86e234dd83d1e361a14b149d5c77ee85122de8f2d68f3bdde94df3de28040696",
    nrmSha: "3002943938dbd3b56202b34da479a9aa66caa1c94853fed0909b4e536dd1344e",
    first: [0, 0.11999999731779099, 0, -1.850786221699888e-18, 0.11697942018508911, -0.012997022829949856],
    last: [0.0005993627710267901, 1.7741109132766724, -0.013119129464030266, 0, 1.774999976158142, 0],
  },
  eyes: [
    {
      side: -1,
      center: [-0.17, 1.19, 0.5722100661104107],
      normal: [-0.22608101275520437, -0.03908980383946916, 0.9733238735936629],
      socketPos: [-0.16547837974489593, 1.1907817960767892, 0.5527435886385375],
      socketQuat: [0.015436499369415702, -0.11445426025442003, 0.03689048237792427, 0.9926233067517384],
      sockM: [
        0.08873230974672049, 0.006369126151687416, 0.020866290136867742, 0,
        -0.013703489882713383, 0.17792908802657975, 0.0039628271554555, 0,
        -0.012411847600260721, -0.0021460302307868564, 0.0534354806602921, 0,
        -0.16547837974489593, 1.1907817960767892, 0.5527435886385375, 1,
      ],
      eyeO: [0, 0, 0],
    },
    {
      side: 1,
      center: [0.17, 1.19, 0.5722100661100752],
      normal: [0.22608101276755752, -0.03908980384759549, 0.9733238735904673],
      socketPos: [0.16547837974464885, 1.1907817960769518, 0.5527435886382659],
      socketQuat: [0.015436499373217153, 0.11445426026088766, -0.03689048237848268, 0.9926233067509126],
      sockM: [
        0.0887323097464424, -0.0063691261516853875, -0.020866290138050914, 0,
        0.013703489883091358, 0.17792908802652313, 0.003962827156690062, 0,
        0.012411847600938906, -0.0021460302312329925, 0.053435480660116656, 0,
        0.16547837974464885, 1.1907817960769518, 0.5527435886382659, 1,
      ],
      eyeO: [0, 0, 0],
    },
  ],
  uEyeC: [
    [-0.17, 1.19, 0.5722100661104107],
    [0.17, 1.19, 0.5722100661100752],
  ],
  sphere: { vertices: 3185, indices: 18048 },
  sceneTree: [
    "Scene:1", "Group:1", "Group:1", "Group:1", "Group:1", "Group:4", "Group:1", "Group:2", "Group:2", "Group:2",
    "Mesh:0", "Mesh:0", "Mesh:0", "Group:2", "Group:2", "Mesh:0", "Mesh:0", "Mesh:0", "Mesh:0", "Mesh:0", "PointLight:0",
  ],
};

const v = (p: THREE.Vector3) => [p.x, p.y, p.z];
const sha = (ta: ArrayLike<number> & ArrayBufferView) =>
  createHash("sha256").update(Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength)).digest("hex");

/** The dummy rig the goldens were made with: only what 1532-1588 reads, no renderer, no shaders. */
function build() {
  const calls: string[] = [];
  const surface = createSurface();
  const scene = new THREE.Scene();
  const V3 = () => new THREE.Vector3();
  const U = { uEyeC: { value: [V3(), V3()] } };
  const bodyMat = new THREE.MeshPhysicalMaterial();
  const bodyPreMat = new THREE.MeshBasicMaterial();
  const bodyDepthMat = new THREE.MeshDepthMaterial();
  const corneaMat = new THREE.MeshPhysicalMaterial();
  const BEAD_LID = { x: 0.085 * 1.075, y: 0.17 * 1.05, z: 0.045 * 1.22 };
  const makeBeadMat = (outer: number) => { calls.push("bead" + outer); return new THREE.MeshPhysicalMaterial(); };
  const makeLidMat = (outer: number) => {
    calls.push("lid" + outer);
    const m = new THREE.MeshPhysicalMaterial();
    m.userData.u = { uSockM: { value: new THREE.Matrix4() }, uEyeO: { value: new THREE.Vector3() } };
    return m;
  };
  const rc = { ...surface, scene, U, bodyMat, bodyPreMat, bodyDepthMat, corneaMat, BEAD_LID, makeBeadMat, makeLidMat };
  const ch = createCharacter(rc as unknown as Parameters<typeof createCharacter>[0]);
  return { calls, surface, scene, U, ch, mats: { bodyMat, bodyPreMat, bodyDepthMat, corneaMat } };
}

describe("surface math (1426-1503)", () => {
  const s = createSurface();

  it("keeps the profile, its sampling and the eye angle", () => {
    expect(s.PROFILE_PTS.length).toBe(16);
    expect(s.TOP_SQUASH).toBe(0.75);
    expect([s.NP, s.NR]).toEqual([200, 160]);
    expect(s.DENSE_MAX).toBe(GOLDEN.DENSE_MAX);
    expect(s.EYE_TH).toBe(GOLDEN.EYE_TH);
    expect(s.DENSE.length).toBe(GOLDEN.DENSE_len);
    expect(s.PROFILE.length).toBe(GOLDEN.PROFILE_len);
    expect(v(s.PROFILE[0])).toEqual(GOLDEN.PROFILE0);
    expect(v(s.PROFILE[199])).toEqual(GOLDEN.PROFILE199);
    expect(v(s.DENSE[s.DENSE_MAX])).toEqual(GOLDEN.DENSE_at_max);
  });

  it("profileRAtY, surfaceAt, surfaceNormal and arcOf equal the prototype's", () => {
    expect([0.5, 1.0, 1.19, 1.5, 1.79, 1.81].map((y) => s.profileRAtY(y))).toEqual(GOLDEN.profileRAtY);
    expect([[0.3, 1.0], [2.51, 0.15]].map(([a, b]) => v(s.surfaceAt(a, b)))).toEqual(GOLDEN.surfaceAt);
    expect(v(s.surfaceAt(0.25, 1.19, new THREE.Vector3(), true))).toEqual(GOLDEN.surfaceAtSockets);
    expect(v(s.surfaceNormal(0.3, 1.0))).toEqual(GOLDEN.surfaceNormal);
    const a = s.arcOf(new THREE.Vector3(0.2, 1.1, 0.5));
    expect([a.x, a.y]).toEqual(GOLDEN.arcOf);
  });

  it("solveXY and solveArc equal the prototype's at fixed points", () => {
    expect([[0.17, 1.19], [-0.17, 1.19], [0, 0.86], [0.3, 1.5]].map(([a, b]) => s.solveXY(a, b))).toEqual(GOLDEN.solveXY);
    expect([[0.1, 1.2], [-0.25, 0.9], [0, 1.6]].map(([a, b]) => s.solveArc(a, b))).toEqual(GOLDEN.solveArc);
  });

  it("each engine gets its own scratch vectors: a second surface answers the same", () => {
    const t = createSurface();
    s.surfaceNormal(1.1, 0.4);
    expect(t.solveXY(0.17, 1.19)).toEqual(GOLDEN.solveXY[0]);
    expect(v(t.surfaceNormal(0.3, 1.0))).toEqual(GOLDEN.surfaceNormal);
  });
});

describe("body geometry (1505-1530)", () => {
  const g = createSurface().buildBodyGeometry();

  it("has the prototype's vertex and index counts and only position plus computed normals", () => {
    expect(g.attributes.position.count).toBe(GOLDEN.body.vertices);
    expect(g.index!.count).toBe(GOLDEN.body.indices);
    expect(g.index!.array.constructor.name).toBe(GOLDEN.body.indexType);
    expect(Object.keys(g.attributes).sort()).toEqual(["normal", "position"]);
  });

  it("positions, indices and normals hash to the goldens", () => {
    const pos = g.attributes.position.array as Float32Array;
    expect(sha(pos)).toBe(GOLDEN.body.posSha);
    expect(sha(g.index!.array as Uint16Array)).toBe(GOLDEN.body.idxSha);
    expect(sha(g.attributes.normal.array as Float32Array)).toBe(GOLDEN.body.nrmSha);
    expect(Array.from(pos.slice(0, 6))).toEqual(GOLDEN.body.first);
    expect(Array.from(pos.slice(-6))).toEqual(GOLDEN.body.last);
  });
});

describe("scene graph, body meshes and eyes (1532-1588)", () => {
  it("makes the bead material before the lid material, left eye first", () => {
    expect(build().calls).toEqual(GOLDEN.calls);
  });

  it("builds the prototype's scene tree in the prototype's order", () => {
    const { scene } = build();
    const names: string[] = [];
    scene.traverse((o) => names.push(o.type + ":" + o.children.length));
    expect(names).toEqual(GOLDEN.sceneTree);
  });

  it("keeps the group offsets, render orders, shadow flags and the glow light", () => {
    const { ch, mats } = build();
    expect([ch.root.position.y, ch.root.rotation.y]).toEqual([0.30, THREE.MathUtils.degToRad(18)]);
    expect([ch.tiltG.position.y, ch.tiltIn.position.y, ch.squashG.position.y, ch.content.position.y]).toEqual([0.4, -0.4, 0.55, -0.55]);
    expect([ch.head.position.y, ch.headInner.position.y]).toEqual([0.95, -0.95]);
    expect(ch.bodyPre.geometry).toBe(ch.bodyGeo);
    expect(ch.body.geometry).toBe(ch.bodyGeo);
    expect(ch.bodyPre.material).toBe(mats.bodyPreMat);
    expect(ch.body.material).toBe(mats.bodyMat);
    expect(ch.body.customDepthMaterial).toBe(mats.bodyDepthMat);
    expect([ch.bodyPre.renderOrder, ch.body.renderOrder]).toEqual([5, 10]);
    expect([ch.body.castShadow, ch.body.receiveShadow, ch.bodyPre.castShadow]).toEqual([true, true, false]);
    expect([ch.bodyPre.frustumCulled, ch.body.frustumCulled]).toEqual([false, false]);
    expect(ch.glowLight.color.getHex()).toBe(new THREE.Color(0x9EF7B0).getHex());
    expect([ch.glowLight.intensity, ch.glowLight.distance, ch.glowLight.decay]).toEqual([2.0, 4, 2]);
    expect(v(ch.glowLight.position)).toEqual([0, 0.72, 0.18]);
    expect(ch.glowLight.parent).toBe(ch.content);
    expect(ch.sphereGeo.attributes.position.count).toBe(GOLDEN.sphere.vertices);
    expect(ch.sphereGeo.index!.count).toBe(GOLDEN.sphere.indices);
    expect(v(ch.BEAD)).toEqual([0.085, 0.17, 0.045]);
  });

  it("places each eye at the prototype's P, N, socket transform and uSockM; uEyeO is never written", () => {
    const { ch } = build();
    expect(ch.eyes.length).toBe(2);
    ch.eyes.forEach((e, i) => {
      const gold = GOLDEN.eyes[i];
      expect(e.side).toBe(gold.side);
      expect(v(e.center)).toEqual(gold.center);
      expect(v(e.normal)).toEqual(gold.normal);
      expect(v(e.socket.position)).toEqual(gold.socketPos);
      expect([e.socket.quaternion.x, e.socket.quaternion.y, e.socket.quaternion.z, e.socket.quaternion.w]).toEqual(gold.socketQuat);
      expect(Array.from(e.lidMat.userData.u.uSockM.value.elements as number[])).toEqual(gold.sockM);
      expect(v(e.lidMat.userData.u.uEyeO.value)).toEqual(gold.eyeO);
      expect(e.socket.parent).toBe(ch.headInner);
      expect(e.bead.parent).toBe(e.ball);
      expect(v(e.bead.scale)).toEqual([0.085, 0.17, 0.045]);
      expect([e.bead.castShadow, e.bead.receiveShadow]).toEqual([true, true]);
      const [, cornea] = e.ball.children as THREE.Mesh[];
      expect(v(cornea.scale)).toEqual([0.085 * 1.035, 0.17 * 1.03, 0.045 * 1.12]);
      expect(cornea.renderOrder).toBe(14);
      const [, lid] = e.socket.children as THREE.Mesh[];
      expect(lid.material).toBe(e.lidMat);
      expect(v(lid.scale)).toEqual([0.085 * 1.075, 0.17 * 1.05, 0.045 * 1.22]);
      expect([lid.castShadow, lid.receiveShadow]).toEqual([false, true]);
    });
  });

  it("writes U.uEyeC from the eye centres", () => {
    const { U } = build();
    expect(U.uEyeC.value.map(v)).toEqual(GOLDEN.uEyeC);
  });
});
