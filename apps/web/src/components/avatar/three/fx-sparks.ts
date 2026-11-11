// Prototype franki.html 2203-2310 (section 8: the spark pool, its instanced mesh, emitSparks, updateSparks),
// ported in WP7. Allowed edits E1, E3. The scratch vectors (_w1.._w4) live in this factory. Draws from the one
// `rnd` stream in the prototype's order.
import * as THREE from "three";
import type { Bolt } from "./brass";
import type { CharacterPart } from "./character";
import { type ConfigPart, DEG } from "./config";
import type { RandomPart } from "./math";
import type { StagePart } from "./stage";

/** The CPU spark pool (2205-2209). */
export interface SparkPool {
  n: number;
  cap: number;
  prevN: number;
  pos: Float32Array<ArrayBuffer>;
  vel: Float32Array<ArrayBuffer>;
  life: Float32Array<ArrayBuffer>;
  bounce: Uint8Array<ArrayBuffer>;
  /** Per spark: brightness, size. */
  look: Float32Array<ArrayBuffer>;
}

export interface SparksPart {
  SPARK_MAX: number;
  spark: SparkPool;
  sparkGeo: THREE.InstancedBufferGeometry;
  sparkMat: THREE.ShaderMaterial;
  sparks: THREE.Mesh;
  UP_AXIS: THREE.Vector3;
  RIGHT_AXIS: THREE.Vector3;
  emitSparks(b: Bolt, count: number, power?: number, dim?: number, size?: number): void;
  updateSparks(dt: number): void;
}

export function createSparks(rc: ConfigPart & RandomPart & StagePart & CharacterPart): SparksPart {
  const { rnd, rr, scene, headInner } = rc;

/* Sparks: GPU-instanced velocity-stretched streaks plus a few slow embers; CPU simulation, one draw call. */
const SPARK_MAX = 256;
const spark: SparkPool = {
  n: 0, cap: SPARK_MAX, prevN: -1,
  pos: new Float32Array(SPARK_MAX * 3), vel: new Float32Array(SPARK_MAX * 3), life: new Float32Array(SPARK_MAX * 3), bounce: new Uint8Array(SPARK_MAX),
  look: new Float32Array(SPARK_MAX * 2),                          // per spark: brightness, size
};
const sparkGeo = new THREE.InstancedBufferGeometry();
{
  const plane = new THREE.PlaneGeometry(1, 1);
  sparkGeo.index = plane.index;
  sparkGeo.setAttribute('position', plane.attributes.position);
  sparkGeo.setAttribute('uv', plane.attributes.uv);
  sparkGeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(spark.pos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('iVel', new THREE.InstancedBufferAttribute(spark.vel, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('iLife', new THREE.InstancedBufferAttribute(spark.life, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('iLook', new THREE.InstancedBufferAttribute(spark.look, 2).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.instanceCount = 0;
}
const sparkMat = new THREE.ShaderMaterial({
  vertexShader: /* glsl */`
    attribute vec3 iPos, iVel, iLife; attribute vec2 iLook; varying vec2 vUv; varying float vT; varying float vKind; varying float vSeed; varying float vDim;
    void main(){
      vUv = uv; vT = clamp(iLife.x / iLife.y, 0.0, 1.0); vKind = step(1.0, iLife.z); vSeed = fract(iLife.z); vDim = iLook.x;
      vec4 mvP = modelViewMatrix * vec4(iPos, 1.0);
      vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
      vec2 dir = normalize(vv.xy + vec2(1e-5, 0.0));
      float len = vKind > 0.5 ? 0.012 : clamp(length(vv) * 0.022, 0.03, 0.09);
      float wid = (vKind > 0.5 ? 0.012 : 0.005) * (1.0 - 0.6 * vT) * iLook.y;
      len *= mix(1.0, iLook.y, 0.6);
      mvP.xy += dir * (position.y * len) + vec2(dir.y, -dir.x) * (position.x * wid);   // (x, y) -> (side, dir) keeps the quad's winding: (-dir.y, dir.x) mirrored it and every spark was back-face culled
      gl_Position = projectionMatrix * mvP;
    }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv; varying float vT; varying float vKind; varying float vSeed; varying float vDim;
    void main(){
      vec2 q = (vUv - 0.5) * 2.0;
      float d = vKind > 0.5 ? length(q) : length(q * vec2(1.0, 0.55));
      float a = 1.0 - smoothstep(0.2, 1.0, d);
      vec3 hot = mix(vec3(1.0, 0.96, 0.85), vec3(1.0, 0.82, 0.30), smoothstep(0.0, 0.35, vT));
      hot = mix(hot, vec3(1.0, 0.54, 0.12), smoothstep(0.35, 1.0, vT));
      float tw = 0.75 + 0.25 * sin(vSeed * 60.0 + vT * 40.0);                 // twinkle
      gl_FragColor = vec4(hot * a * (1.0 - vT) * tw * (vKind > 0.5 ? 2.5 : 7.0) * vDim, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const sparks = new THREE.Mesh(sparkGeo, sparkMat);
sparks.frustumCulled = false; sparks.renderOrder = 21;
scene.add(sparks);

const _w1 = new THREE.Vector3(), _w2 = new THREE.Vector3(), _w3 = new THREE.Vector3(), _w4 = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0), RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
function emitSparks(b: Bolt, count: number, power = 1, dim = 1, size = 1) {
  const tipW = headInner.localToWorld(_w1.copy(b.tip));
  const axisW = _w2.copy(b.axis).transformDirection(headInner.matrixWorld);
  const p1 = _w3.copy(axisW).cross(Math.abs(axisW.y) < 0.9 ? UP_AXIS : RIGHT_AXIS).normalize();
  const p2 = _w4.copy(axisW).cross(p1).normalize();
  for (let k = 0; k < count && spark.n < spark.cap; k++) {
    const i = spark.n++, ember = rnd() < 0.12;
    const a = rnd() * Math.PI * 2, cone = Math.tan(35 * DEG) * Math.sqrt(rnd());
    const dx = axisW.x + (p1.x * Math.cos(a) + p2.x * Math.sin(a)) * cone;
    const dy = axisW.y + (p1.y * Math.cos(a) + p2.y * Math.sin(a)) * cone + 0.55;    // biased upward
    const dz = axisW.z + (p1.z * Math.cos(a) + p2.z * Math.sin(a)) * cone;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const sp = (ember ? rr(0.3, 0.6) : rr(1.2, 2.6)) * power;
    const rim = rnd() < 0.5 ? 0.1 : 0;
    const ra = rnd() * Math.PI * 2;
    spark.pos[i * 3] = tipW.x + (p1.x * Math.cos(ra) + p2.x * Math.sin(ra)) * rim;
    spark.pos[i * 3 + 1] = tipW.y + (p1.y * Math.cos(ra) + p2.y * Math.sin(ra)) * rim;
    spark.pos[i * 3 + 2] = tipW.z + (p1.z * Math.cos(ra) + p2.z * Math.sin(ra)) * rim;
    spark.vel[i * 3] = dx / dl * sp; spark.vel[i * 3 + 1] = dy / dl * sp; spark.vel[i * 3 + 2] = dz / dl * sp;
    spark.life[i * 3] = 0; spark.life[i * 3 + 1] = ember ? 1.5 : rr(0.35, 0.8); spark.life[i * 3 + 2] = (ember ? 1 : 0) + rnd() * 0.99;
    spark.bounce[i] = rnd() < 0.15 ? 1 : 0;
    spark.look[i * 2] = dim; spark.look[i * 2 + 1] = size * (ember ? 1 : rr(0.8, 1.2));
  }
}
function updateSparks(dt: number) {
  let j = 0;
  for (let i = 0; i < spark.n; i++) {
    const L = spark.life;
    L[i * 3] += dt;
    if (L[i * 3] >= L[i * 3 + 1]) continue;
    const ember = L[i * 3 + 2] >= 1;
    const P = spark.pos, V = spark.vel;
    const drag = Math.exp(-(ember ? 0.6 : 1.5) * dt);
    V[i * 3] *= drag; V[i * 3 + 2] *= drag;
    V[i * 3 + 1] = V[i * 3 + 1] * drag + (ember ? 0.35 : -3.5) * dt;
    P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
    if (P[i * 3 + 1] < 0.003 && V[i * 3 + 1] < 0) {
      if (!spark.bounce[i]) continue;
      spark.bounce[i] = 0; P[i * 3 + 1] = 0.003; V[i * 3 + 1] *= -0.3; V[i * 3] *= 0.6; V[i * 3 + 2] *= 0.6;
    }
    if (j !== i) {
      for (let k = 0; k < 3; k++) { P[j * 3 + k] = P[i * 3 + k]; V[j * 3 + k] = V[i * 3 + k]; L[j * 3 + k] = L[i * 3 + k]; }
      spark.look[j * 2] = spark.look[i * 2]; spark.look[j * 2 + 1] = spark.look[i * 2 + 1];
      spark.bounce[j] = spark.bounce[i];
    }
    j++;
  }
  spark.n = j;
  sparkGeo.instanceCount = j;
  if (j === 0 && spark.prevN === 0) return;                         // nothing alive now or last frame: no upload
  spark.prevN = j;
  for (const name of ['iPos', 'iVel', 'iLife', 'iLook']) {
    const a = sparkGeo.attributes[name] as THREE.BufferAttribute;
    a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, j) * a.itemSize); a.needsUpdate = true;
  }
}

  return { SPARK_MAX, spark, sparkGeo, sparkMat, sparks, UP_AXIS, RIGHT_AXIS, emitSparks, updateSparks };
}
