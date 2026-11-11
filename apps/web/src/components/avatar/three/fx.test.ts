// WP7 (design note §8.1): pins the effects of section 8 (backdrop, ground, motes, sparks, lightning ribbons and
// catch-lights) against the prototype: every ShaderMaterial source and the ground's onBeforeCompile output by
// SHA-256, the mote geometry from mulberry32(909), the buffer sizes, the material flags and render orders, and the
// behaviour of emitSparks, updateSparks, arcs.regen, arcs.shot, writeRibbons and updateCatchLights.
//
// The goldens were computed from the prototype's own code, not from this port: franki.html 204-246 and 2079-2529
// were evaluated in node with three 0.187.0 and the stubs in `makeStubs` below (the same values, in the same order),
// then run through the exercise in the same order as the tests here, with the one `rnd` stream seeded 0xF2A4C1.
// Typed arrays are hashed over their bytes, so one changed bit in any position, seed or formula fails here.
//
// The factories run in node with the real three classes. No renderer is needed: nothing in this range touches GL.
import { createHash } from "node:crypto";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { type CatchPart, createCatch } from "./fx-catch";
import { createLightning, type LightningPart, type Ribbon } from "./fx-lightning";
import { createSparks, type SparksPart } from "./fx-sparks";
import { createWorldFx, type WorldFxPart } from "./fx-world";
import { createRandom } from "./math";

const sha = (x: string | ArrayBufferView) =>
  createHash("sha256")
    .update(typeof x === "string" ? x : Buffer.from(x.buffer, x.byteOffset, x.byteLength))
    .digest("hex");

const G = {
  bgVert: "d7d2bc186ec4d9b63e1df62f168cd9cb9c886b2b9ca1b8461936300e0a1867a8",
  bgFrag: "b941a9f29cae8de1a2941628bc1ab1948b7e73b23c3519665b03b68e97d00949",
  moteVert: "3c494ba9c5002a890a178b9f8cccfb5a8c0cbb1b4e528f4476cfe4ccd4d0add7",
  moteFrag: "dfcd8ba9fb9acf159c79e60ff8c9cf4eabb36d266486af1c6ca487bf258190c2",
  sparkVert: "9f77ff7aff538ef5bd07daebdf5f9771a782742261ac3c8e8763183a64a10818",
  sparkFrag: "7d1cb8cf97c640eeb9df7bcf5f8a7c9231a55b9dc97fa98e652654cb9c9fc2eb",
  arcVert: "c7804c6d38e05bcb36c4e81ae9057886f59a39cfe1592366d84d994e2672d2cc",
  arcFrag: "37704397150d90cf4749f2bfcf89ba3c5c84fe93e7e0bf4505d0d17eb223f6f7",
  catchVert: "5b0955de61f8886b97cd71fd9b95f35eec8c2056e6039127ef751d5b9428c085",
  catchFrag: "044be0fcd8f4384a603feec49cd7df4cf5a4c5993e1693862bdd683387055861",
  groundVert: "acac14ff57fa1ef48157c76ea8b59bc5f2fbfbf8c1bf5ac01b5ec3cdee41f2a4",
  groundFrag: "4281040da81750b5c9d034e49c2c8b940a163119ce1d0e02b269b98aa34ef7a6",
  motePos: "f5608a54f7806031fd3287e0e77114d6fd9fda13108381a7b1395349937173e0",
  moteSeed: "bfe6bd6874c5a61e556b3fc7ff2b600ed68fc249adf5db8ef635b4f66f36a315",
  moteKind: "fe6f69fddc2d3bb99ee578ba822a98415698e416d067d8fa4b76764d2fd13d13",
  moteKindSum: 11,
  sparkN: 22,
  sparkInstances: 22,
  sparkPos: "cf423f5a4129739eb00963df75ad905f7e6db6cdbd9abfa4cba954e30b7f874d",
  sparkVel: "c614ed9c125f5cdc59be54de5f33cca4a2fa1f240986014c44f78938e8131bfc",
  sparkLife: "d08fa9add6bad324fd5f461e40dd2ab310f92b80da9028602d96ef44c6e279b7",
  sparkLook: "aace874db87f823fc0102025caec34a116dd572e9675795075a06c1745ce878a",
  sparkBounce: "93c5387422eea4df44509fbd35de59bb8ebe6dc278ef8f5078c87ef608d6a8ce",
  arcStrips: [65, 9, 5, 5, 9, 5, 5, 9, 9, 9],
  arcMid: [0, 2.13, 0.06],
  arcDraw: 816,
  arcPos: "9bec2d8659d5913644888d95aa9aef286fda75d3902a4ac39f180c2822c04645",
  arcUv: "3c795f1273d909ba78a3ebff58ea1a8e66e2538199b8dbe72bce403cadf8159f",
  arcI: "1020315b0f475eac302983e2737eefaf960e78bd2dbc5827e237db3bf679d13a",
  arcIdx: "2365018bda02ceba941ce233132ba96ecff853413071d9844998d4b55a4550cd",
  arcSmooth: [49],
  arcPrev: 10,
  catchPos: "e5b6f86b1e7fe226385621bdf29f7544c7f03e63dad248d402c44d566eaa80c6",
  catchA: "163dee77dd01b2ed5f3161e7b354feafcbe173ca60bbd81c39ebf5abb5293df1",
  catchUv: "0dea3c8a57535f0e81cc0dbd202242fa921ec1e317fc3bbc46a49c407e1f4145",
  catchK: "dadae85e46f6f9afa1158f3bc46a992b3ffbc56014ad6acc13b05b86a7b84ca5",
  catchIdx: "2675db74ae8e267bde75812130293fcadd7f3059c4b0c3069304018b48efb871",
  catchASum: 13.99367642402649,
  catchShutA: "626d5109fb846f74a4e61c7b697d8e668b3092d2422f9b71426260501f4ebb5b",
  catchShutASum: 2.375000605243258,
  rndAfter: 0.8891801508143544,
};

/** The golden tool's stubs, value for value. Only what section 8 reads is stubbed. */
function makeStubs() {
  const scene = new THREE.Scene();
  const U = { uGlow: { value: 1 } };
  const V3 = () => new THREE.Vector3();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(0.05, 1.22, 6.4);
  camera.lookAt(0, 1.1, 0);
  const keyLight = new THREE.DirectionalLight(0xffe7c4, 2.5);
  keyLight.position.set(-3, 4.2, 4);
  keyLight.target.position.set(0, 1.25, 0);
  const headInner = new THREE.Group();
  headInner.position.set(0.02, 0.31, 0.01);
  headInner.rotation.set(0.04, 0.31, -0.02);
  scene.add(headInner);
  const BEAD = new THREE.Vector3(0.085, 0.17, 0.045);
  const BEAD_LID = { x: 0.085 * 1.075, y: 0.17 * 1.05, z: 0.045 * 1.22 };
  const eyes = [-1, 1].map((s) => {
    const socket = new THREE.Group();
    socket.position.set(s * 0.17, 1.19, 0.52);
    socket.rotation.set(0.05, s * 0.2, (-s * 4 * Math.PI) / 180);
    const ball = new THREE.Group();
    ball.rotation.set(-0.06, 0.08 * s, 0);
    socket.add(ball);
    headInner.add(socket);
    const lidMat = { userData: { u: { uLid: { value: new THREE.Vector4(0.08 + 0.1 * (s + 1), 0.05, 0.02, 0.03) } } } };
    return { side: s, socket, ball, lidMat };
  });
  const bolts = [-1, 1].map((s) => {
    const axis = new THREE.Vector3(s * 0.95, 0.12, 0.28).normalize();
    const base = new THREE.Vector3(s * 0.52, 1.5, 0.05);
    const tip = base.clone().addScaledVector(axis, 0.16);
    const rim = base.clone().addScaledVector(axis, 0.12);
    return { side: s, base, axis, tip, rim, light: null, flash: 0 };
  });
  scene.add(camera, keyLight, keyLight.target);
  scene.updateMatrixWorld();
  return { scene, U, V3, camera, keyLight, headInner, BEAD, BEAD_LID, eyes, bolts };
}

interface Built {
  st: ReturnType<typeof makeStubs>;
  rnd: () => number;
  world: WorldFxPart;
  sparks: SparksPart;
  lightning: LightningPart;
  catchLights: CatchPart;
}

/** Builds the four parts in the prototype's order on one shared context, as buildRig does. */
function build(): Built {
  const st = makeStubs();
  const random = createRandom();
  const rc = { ...st, ...random, STILL: false, REDUCED: false };
  const world = createWorldFx(rc as unknown as Parameters<typeof createWorldFx>[0]);
  const sparks = createSparks(rc as unknown as Parameters<typeof createSparks>[0]);
  const lightning = createLightning(rc as unknown as Parameters<typeof createLightning>[0]);
  const catchLights = createCatch(rc as unknown as Parameters<typeof createCatch>[0]);
  return { st, rnd: random.rnd, world, sparks, lightning, catchLights };
}

describe("fx-world (2076-2201)", () => {
  const { st, world } = build();

  it("keeps the backdrop and mote shaders byte for byte", () => {
    expect(sha(world.bgMat.vertexShader)).toBe(G.bgVert);
    expect(sha(world.bgMat.fragmentShader)).toBe(G.bgFrag);
    expect(sha(world.moteMat.vertexShader)).toBe(G.moteVert);
    expect(sha(world.moteMat.fragmentShader)).toBe(G.moteFrag);
  });

  it("injects the ground's shader code into three r187's standard material source", () => {
    const s = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as THREE.WebGLProgramParametersWithUniforms;
    world.groundMat.onBeforeCompile(s, {} as THREE.WebGLRenderer);
    expect(sha(s.vertexShader)).toBe(G.groundVert);
    expect(sha(s.fragmentShader)).toBe(G.groundFrag);
    expect(s.vertexShader).toContain("vGW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    expect(s.fragmentShader).toContain("outgoingLight *= 1.0 - sh * sh * uShA;");
    for (const k of Object.keys(world.groundU) as (keyof typeof world.groundU)[]) expect(s.uniforms[k]).toBe(world.groundU[k]);
    expect(world.groundMat.customProgramCacheKey()).toBe("fk-ground-1");
  });

  it("draws the motes from mulberry32(909) in the prototype's order", () => {
    expect(world.MOTES).toBe(231);
    expect(world.moteGeo.attributes.position.count).toBe(231);
    expect(sha(world.moteGeo.attributes.position.array as Float32Array)).toBe(G.motePos);
    expect(sha(world.moteGeo.attributes.aSeed.array as Float32Array)).toBe(G.moteSeed);
    expect(sha(world.moteGeo.attributes.aKind.array as Float32Array)).toBe(G.moteKind);
    expect((world.moteGeo.attributes.aKind.array as Float32Array).reduce((a, b) => a + b, 0)).toBe(G.moteKindSum);
  });

  it("shares uGlow with U by reference and keeps the flags and render orders", () => {
    expect(world.moteMat.uniforms.uGlow).toBe(st.U.uGlow);
    expect(world.moteMat.uniforms.uPR.value).toBe(1);
    expect(world.bgMat.depthTest).toBe(false);
    expect(world.bgMat.depthWrite).toBe(false);
    expect(world.bgMat.transparent).toBe(false);
    expect(world.bg.renderOrder).toBe(-100);
    expect(world.bg.frustumCulled).toBe(false);
    expect(world.groundMat.transparent).toBe(true);
    expect(world.groundMat.depthWrite).toBe(false);
    expect(world.groundMat.color.getHex()).toBe(0x0c1513);
    expect(world.ground.renderOrder).toBe(-50);
    expect(world.ground.receiveShadow).toBe(true);
    expect(world.ground.rotation.x).toBe(-Math.PI / 2);
    expect(world.groundU.uShR.value.toArray()).toEqual([0.78, 0.62]);
    expect(world.groundU.uShA.value).toBe(0.55);
    expect(world.groundU.uTurn.value).toBe(THREE.MathUtils.degToRad(18));
    expect(world.groundU.uPoolI.value).toBe(0.25);
    expect(world.moteMat.transparent).toBe(true);
    expect(world.moteMat.depthWrite).toBe(false);
    expect(world.moteMat.blending).toBe(THREE.AdditiveBlending);
    expect(world.motes.renderOrder).toBe(22);
    expect(world.motes.frustumCulled).toBe(false);
  });
});

describe("fx-sparks, fx-lightning and fx-catch (2203-2529)", () => {
  const b = build();
  const { st, world, sparks, lightning, catchLights } = b;

  it("adds the six effect objects to the scene in the prototype's order", () => {
    const fx = [world.bg, world.ground, world.motes, sparks.sparks, lightning.arcMesh, catchLights.catchMesh];
    const order = st.scene.children.filter((c) => fx.includes(c as THREE.Mesh));
    expect(order).toEqual(fx);
  });

  it("keeps every effect shader byte for byte", () => {
    expect(sha(sparks.sparkMat.vertexShader)).toBe(G.sparkVert);
    expect(sha(sparks.sparkMat.fragmentShader)).toBe(G.sparkFrag);
    expect(sha(lightning.arcMat.vertexShader)).toBe(G.arcVert);
    expect(sha(lightning.arcMat.fragmentShader)).toBe(G.arcFrag);
    expect(sha(catchLights.catchMat.vertexShader)).toBe(G.catchVert);
    expect(sha(catchLights.catchMat.fragmentShader)).toBe(G.catchFrag);
  });

  it("keeps the buffer sizes", () => {
    expect(sparks.SPARK_MAX).toBe(256);
    expect(sparks.spark.cap).toBe(256);
    expect(sparks.spark.pos.length).toBe(256 * 3);
    expect(sparks.spark.vel.length).toBe(256 * 3);
    expect(sparks.spark.life.length).toBe(256 * 3);
    expect(sparks.spark.bounce.length).toBe(256);
    expect(sparks.spark.look.length).toBe(256 * 2);
    expect(sparks.sparkGeo.attributes.iPos.array).toBe(sparks.spark.pos);
    expect(sparks.sparkGeo.attributes.iLook.array).toBe(sparks.spark.look);
    expect(sparks.sparkGeo.index!.count).toBe(6);
    expect(lightning.ARC_MAXP).toBe(1800);
    expect(lightning.arcGeo.attributes.position.array.length).toBe(1800 * 2 * 3);
    expect(lightning.arcGeo.attributes.aUV.array.length).toBe(1800 * 2 * 2);
    expect(lightning.arcGeo.attributes.aI.array.length).toBe(1800 * 2);
    expect(lightning.arcGeo.index!.array).toBeInstanceOf(Uint16Array);
    expect(lightning.arcGeo.index!.array.length).toBe(1800 * 6);
    expect(catchLights.CATCH_N).toBe(4);
    expect(catchLights.catchGeo.attributes.position.array.length).toBe(4 * 4 * 3);
    expect(sha(catchLights.catchGeo.attributes.aUv.array as Float32Array)).toBe(G.catchUv);
    expect(sha(catchLights.catchGeo.attributes.aK.array as Float32Array)).toBe(G.catchK);
    expect(sha(catchLights.catchGeo.index!.array as Uint16Array)).toBe(G.catchIdx);
    expect(catchLights.CORNEA.toArray()).toEqual([0.085 * 1.035, 0.17 * 1.03, 0.045 * 1.12]);
  });

  it("keeps the flags and render orders", () => {
    for (const m of [sparks.sparkMat, lightning.arcMat, catchLights.catchMat]) {
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.blending).toBe(THREE.AdditiveBlending);
    }
    expect(lightning.arcMat.side).toBe(THREE.DoubleSide);
    expect(sparks.sparkMat.side).toBe(THREE.FrontSide);
    expect(sparks.sparks.renderOrder).toBe(21);
    expect(lightning.arcMesh.renderOrder).toBe(20);
    expect(catchLights.catchMesh.renderOrder).toBe(15);
    for (const o of [sparks.sparks, lightning.arcMesh, catchLights.catchMesh]) expect(o.frustumCulled).toBe(false);
  });

  // The exercise below runs in the golden tool's order on the one rnd stream; each step depends on the last.
  it("emits and simulates sparks as the prototype does", () => {
    sparks.emitSparks(st.bolts[0] as never, 20);
    sparks.emitSparks(st.bolts[1] as never, 14, 0.5, 0.35, 0.8);
    for (let i = 0; i < 30; i++) sparks.updateSparks(1 / 60);
    expect(sparks.spark.n).toBe(G.sparkN);
    expect(sparks.sparkGeo.instanceCount).toBe(G.sparkInstances);
    expect(sha(sparks.spark.pos)).toBe(G.sparkPos);
    expect(sha(sparks.spark.vel)).toBe(G.sparkVel);
    expect(sha(sparks.spark.life)).toBe(G.sparkLife);
    expect(sha(sparks.spark.look)).toBe(G.sparkLook);
    expect(sha(sparks.spark.bounce)).toBe(G.sparkBounce);
  });

  it("grows the standing arc, a one-shot arc and the ribbons as the prototype does", () => {
    lightning.arcs.regen(1.0, false);
    expect(lightning.arcs.main.map((x) => x.pts.length)).toEqual(G.arcStrips);
    expect(lightning.arcs.mid.toArray()).toEqual(G.arcMid);
    expect(lightning.arcs.lastRegen).toBe(1.0);
    lightning.arcs.shot(new THREE.Vector3(0, 2.6, 0.1), st.bolts[0].tip, 0.3, 1.0);
    expect(lightning.arcs.fx).toHaveLength(1);
    expect(lightning.arcs.fx[0].w).toBe(0.022);
    const list: Ribbon[] = [...lightning.arcs.main, { pts: lightning.arcs.fx[0].pts, w: lightning.arcs.fx[0].w, k: 0.9 }];
    lightning.writeRibbons(list);
    expect(lightning.arcGeo.drawRange.count).toBe(G.arcDraw);
    expect(sha(lightning.arcGeo.attributes.position.array as Float32Array)).toBe(G.arcPos);
    expect(sha(lightning.arcGeo.attributes.aUV.array as Float32Array)).toBe(G.arcUv);
    expect(sha(lightning.arcGeo.attributes.aI.array as Float32Array)).toBe(G.arcI);
    expect(sha(lightning.arcGeo.index!.array as Uint16Array)).toBe(G.arcIdx);
    lightning.arcs.regen(2.0, true);
    expect(lightning.arcs.main.map((x) => x.pts.length)).toEqual(G.arcSmooth);
    expect(lightning.arcs.prev).toHaveLength(G.arcPrev);
  });

  it("places the catch-lights and hides them under the lids as the prototype does", () => {
    catchLights.updateCatchLights();
    expect(sha(catchLights.catchGeo.attributes.position.array as Float32Array)).toBe(G.catchPos);
    expect(sha(catchLights.catchGeo.attributes.aA.array as Float32Array)).toBe(G.catchA);
    expect(Array.from(catchLights.catchGeo.attributes.aA.array).reduce((a, v) => a + v, 0)).toBe(G.catchASum);
    st.eyes[0].lidMat.userData.u.uLid.value.set(0.36, 0.12, 0.05, 0.04);
    st.eyes[1].lidMat.userData.u.uLid.value.set(0.42, 0.18, -0.05, 0.02);
    catchLights.updateCatchLights();
    expect(sha(catchLights.catchGeo.attributes.aA.array as Float32Array)).toBe(G.catchShutA);
    expect(Array.from(catchLights.catchGeo.attributes.aA.array).reduce((a, v) => a + v, 0)).toBe(G.catchShutASum);
  });

  it("leaves the shared rnd stream where the prototype leaves it", () => {
    expect(b.rnd()).toBe(G.rndAfter);
  });
});
