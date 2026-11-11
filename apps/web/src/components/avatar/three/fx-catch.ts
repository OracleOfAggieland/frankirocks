// Prototype franki.html 2447-2529 (section 8: the catch-lights), ported in WP7. Allowed edits E1, E3, and E11:
// `_view` (declared at 2409 in fx-lightning.ts) is re-declared here, because every use writes it before reading
// it. Reads BEAD_LID (2516). Its JS copy of fk_lidTop/fk_lidBot (2517) stays in step with glsl.ts (map A
// finding 5). updateCatchLights runs after the frame's one scene.updateMatrixWorld().
import * as THREE from "three";
import type { CharacterPart } from "./character";
import { C, COL } from "./config";
import { smooth } from "./math";
import type { BodyMaterialsPart } from "./materials-body";
import type { StagePart } from "./stage";

export interface CatchPart {
  CATCH_N: number;
  catchGeo: THREE.BufferGeometry;
  catchMat: THREE.ShaderMaterial;
  catchMesh: THREE.Mesh;
  CORNEA: THREE.Vector3;
  updateCatchLights(): void;
}

export function createCatch(rc: StagePart & BodyMaterialsPart & CharacterPart): CatchPart {
  const { scene, camera, keyLight, BEAD_LID, BEAD, eyes } = rc;
  const _view = new THREE.Vector3();   // contract: E11, the scratch vector of fx-lightning.ts (2409); every use below writes it before reading it

/* Catch-lights: anchored to the key light and the viewer, placed where the cornea's normal is the half vector, so they stay put as the eyes move. */
const CATCH_N = eyes.length * 2;
const catchGeo = new THREE.BufferGeometry();
const catchPos = new Float32Array(CATCH_N * 4 * 3), catchUv = new Float32Array(CATCH_N * 4 * 2), catchK = new Float32Array(CATCH_N * 4), catchA = new Float32Array(CATCH_N * 4);
{
  const idx: number[] = [];
  for (let q = 0; q < CATCH_N; q++) {
    const b = q * 4;
    catchUv.set([0, 0, 1, 0, 1, 1, 0, 1], q * 8);
    catchK.fill(q % 2, b, b + 4);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  catchGeo.setAttribute('position', new THREE.BufferAttribute(catchPos, 3).setUsage(THREE.DynamicDrawUsage));
  catchGeo.setAttribute('aUv', new THREE.BufferAttribute(catchUv, 2));
  catchGeo.setAttribute('aK', new THREE.BufferAttribute(catchK, 1));
  catchGeo.setAttribute('aA', new THREE.BufferAttribute(catchA, 1).setUsage(THREE.DynamicDrawUsage));
  catchGeo.setIndex(idx);
}
const catchMat = new THREE.ShaderMaterial({
  uniforms: { uC2: { value: C(COL.catch2) } },
  vertexShader: 'attribute vec2 aUv; attribute float aK; attribute float aA; varying vec2 vUv; varying float vK; varying float vA; void main(){ vUv = aUv; vK = aK; vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform vec3 uC2; varying vec2 vUv; varying float vK; varying float vA;
    void main(){
      vec2 q = vUv * 2.0 - 1.0;
      vec3 c; float a;
      if (vK < 0.5) {
        q.x += q.y * 0.18;                                                    // a slightly skewed rounded square, like a window
        float d = pow(pow(abs(q.x), 2.6) + pow(abs(q.y), 2.6), 1.0 / 2.6);   // a soft rounded window
        a = 1.0 - smoothstep(0.84, 1.0, d); c = vec3(0.9);                   // crisp and under the bloom threshold: a bead highlight, not a glowing blob
      } else {
        a = 1.0 - smoothstep(0.25, 1.0, length(q)); c = uC2 * 0.6;
      }
      gl_FragColor = vec4(c * a * vA, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const catchMesh = new THREE.Mesh(catchGeo, catchMat);
catchMesh.frustumCulled = false; catchMesh.renderOrder = 15;
scene.add(catchMesh);

const CORNEA = new THREE.Vector3(BEAD.x * 1.035, BEAD.y * 1.03, BEAD.z * 1.12);
const _ew = new THREE.Vector3(), _eq = new THREE.Quaternion(), _eqi = new THREE.Quaternion(), _h = new THREE.Vector3(), _hl = new THREE.Vector3();
const _cp = new THREE.Vector3(), _cr = new THREE.Vector3(), _cu = new THREE.Vector3(), _lk = new THREE.Vector3(), _lf = new THREE.Vector3();
const _camR = new THREE.Vector3(), _camU = new THREE.Vector3();
const CATCH_CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
const _lp = new THREE.Vector3(), _lkV = new THREE.Vector3();
const CATCH_SPEC: [THREE.Vector3, number, number, number][] = [[_lk, 0.019, 0.025, 1.0], [_lf, 0.009, 0.009, 0.75]];   // a big window highlight (as in the art) and a small second dot
function updateCatchLights() {
  _lk.subVectors(keyLight.position, keyLight.target.position).normalize();
  _lkV.setFromMatrixColumn(camera.matrixWorld, 2);                           // toward the viewer
  _lk.addScaledVector(_lkV, 0.9).normalize();                               // a lower, frontal 'window': the highlight sits inside the bead, as in the art, not on the rim under the lid
  _camR.setFromMatrixColumn(camera.matrixWorld, 0); _camU.setFromMatrixColumn(camera.matrixWorld, 1);
  for (let ei = 0; ei < eyes.length; ei++) {
    const e = eyes[ei];
    e.ball.getWorldPosition(_ew); e.ball.getWorldQuaternion(_eq); _eqi.copy(_eq).invert();
    _view.subVectors(camera.position, _ew).normalize();
    _lf.copy(_camR).multiplyScalar(0.75).addScaledVector(_camU, -0.55).addScaledVector(_view, 0.5).normalize();
    for (let k = 0; k < CATCH_SPEC.length; k++) {
      const [L, hw, hh, alpha] = CATCH_SPEC[k];
      _h.addVectors(L, _view).normalize();
      _hl.copy(_h).applyQuaternion(_eqi);                                   // the half vector in ball space
      const a2 = CORNEA.x ** 2, b2 = CORNEA.y ** 2, c2 = CORNEA.z ** 2;
      const kk = Math.sqrt(a2 * _hl.x ** 2 + b2 * _hl.y ** 2 + c2 * _hl.z ** 2) || 1;
      _cp.set(a2 * _hl.x / kk, b2 * _hl.y / kk, c2 * _hl.z / kk).multiplyScalar(1.004);   // ellipsoid point whose normal is _hl
      _cp.applyQuaternion(_eq).add(_ew);
      _cr.crossVectors(_camU, _h).normalize(); _cu.crossVectors(_h, _cr);
      // A flat quad on a curved cornea pokes through a closing lid at its corners: hide the highlight wherever the lid covers it.
      e.socket.worldToLocal(_lp.copy(_cp));
      const lx = _lp.x / BEAD_LID.x, ly = _lp.y / BEAD_LID.y, Lw = e.lidMat.userData.u.uLid.value;
      const lt = 1.1 - 2.05 * Lw.x + 0.18 * (1 - Lw.x) * (1 - lx * lx) - Lw.z * lx * e.side, lb = -1.1 + 1.6 * Lw.y + Lw.w * (1 - lx * lx);
      const open = smooth(0.1, 0.32, lt - ly) * smooth(0.06, 0.22, ly - lb);   // gone before the lid edge reaches it: never a cut-off glare
      const q = (ei * 2 + k) * 4, vis = smooth(0.15, 0.45, _hl.z) * alpha * open;
      for (let c = 0; c < 4; c++) {
        const o = (q + c) * 3, sx = CATCH_CORNERS[c * 2] * hw, sy = CATCH_CORNERS[c * 2 + 1] * hh;
        catchPos[o] = _cp.x + _cr.x * sx + _cu.x * sy; catchPos[o + 1] = _cp.y + _cr.y * sx + _cu.y * sy; catchPos[o + 2] = _cp.z + _cr.z * sx + _cu.z * sy;
        catchA[q + c] = vis;
      }
    }
  }
  catchGeo.attributes.position.needsUpdate = true;
  catchGeo.attributes.aA.needsUpdate = true;
}

  return { CATCH_N, catchGeo, catchMat, catchMesh, CORNEA, updateCatchLights };
}
