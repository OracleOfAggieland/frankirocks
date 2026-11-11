// Prototype franki.html 1532-1588 (section 7: the scene graph, the body meshes, glowLight and the eyes), ported in
// WP4. Allowed edits E1, E3. Per eye, the bead material is made before the lid material, left eye first.
// Writes U.uEyeC (1588). Keeps the uEyeO line exactly as the prototype has it: inside the comment, never run
// (map A finding 1).
import * as THREE from "three";
import { DEG, EYE_X, EYE_Y, HEAD_PIVOT, HOVER, TURN, type ConfigPart } from "./config";
import type { BodyMaterialsPart } from "./materials-body";
import type { StagePart } from "./stage";
import type { SurfacePart } from "./surface";
import type { UniformsPart } from "./uniforms";

export interface Eye {
  side: number;
  socket: THREE.Group;
  ball: THREE.Group;
  bead: THREE.Mesh;
  beadMat: THREE.MeshPhysicalMaterial;
  lidMat: THREE.MeshPhysicalMaterial;
  center: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface CharacterPart {
  root: THREE.Group;
  tiltG: THREE.Group;
  tiltIn: THREE.Group;
  squashG: THREE.Group;
  content: THREE.Group;
  head: THREE.Group;
  headInner: THREE.Group;
  bodyGeo: THREE.BufferGeometry;
  bodyPre: THREE.Mesh;
  body: THREE.Mesh;
  glowLight: THREE.PointLight;
  sphereGeo: THREE.SphereGeometry;
  BEAD: THREE.Vector3;
  eyes: Eye[];
}

export function createCharacter(rc: ConfigPart & StagePart & UniformsPart & BodyMaterialsPart & SurfacePart): CharacterPart {
  const {
    scene, U, bodyMat, bodyPreMat, bodyDepthMat, BEAD_LID, makeLidMat, makeBeadMat, corneaMat,
    surfaceAt, surfaceNormal, solveXY, buildBodyGeometry,
  } = rc;

  /* --- scene graph: root (hover, turn) > tilt (lean, roll) > squash > content (body) > head (bend) --- */
  const root = new THREE.Group();
  root.position.y = HOVER; root.rotation.y = TURN;
  const tiltG = new THREE.Group(); tiltG.position.y = 0.4;
  const tiltIn = new THREE.Group(); tiltIn.position.y = -0.4;
  const squashG = new THREE.Group(); squashG.position.y = 0.55;
  const content = new THREE.Group(); content.position.y = -0.55;
  const head = new THREE.Group(); head.position.y = HEAD_PIVOT;
  const headInner = new THREE.Group(); headInner.position.y = -HEAD_PIVOT;
  scene.add(root); root.add(tiltG); tiltG.add(tiltIn); tiltIn.add(squashG); squashG.add(content); content.add(head); head.add(headInner);

  const bodyGeo = buildBodyGeometry();
  const bodyPre = new THREE.Mesh(bodyGeo, bodyPreMat);
  bodyPre.renderOrder = 5;                 // transparent queue: after the ground, so whatever is behind the body still shows through in ghost mode
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.renderOrder = 10;
  body.castShadow = true; body.receiveShadow = true;
  body.customDepthMaterial = bodyDepthMat;
  bodyPre.frustumCulled = body.frustumCulled = false;
  content.add(bodyPre, body);

  const glowLight = new THREE.PointLight(0x9EF7B0, 2.0, 4, 2);   // the ghost's own light, inside the body
  glowLight.position.set(0, 0.72, 0.18);
  content.add(glowLight);

  /* --- eyes: socket (fixed) > ball (gaze) > bead + cornea; the lid shell stays on the socket --- */
  const sphereGeo = new THREE.SphereGeometry(1, 64, 48);
  const BEAD = new THREE.Vector3(0.085, 0.17, 0.045);
  const eyes = [] as Eye[];
  for (let s = -1; s <= 1; s += 2) {
    const { th, y } = solveXY(s * EYE_X, EYE_Y);
    const P = surfaceAt(th, y), N = surfaceNormal(th, y);
    const X = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), N).normalize();
    const Y = new THREE.Vector3().crossVectors(N, X);
    const socket = new THREE.Group();
    socket.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, N));
    socket.rotateZ(-s * 4 * DEG);                                  // tops lean outward
    socket.position.copy(P).addScaledVector(N, 0.025 - BEAD.z);    // the bead stands 0.025 proud of the skin
    const ball = new THREE.Group();
    const beadMat = makeBeadMat(s), lidMat = makeLidMat(s);
    const bead = new THREE.Mesh(sphereGeo, beadMat);
    bead.scale.copy(BEAD);
    bead.castShadow = true; bead.receiveShadow = true;
    const cornea = new THREE.Mesh(sphereGeo, corneaMat);
    cornea.scale.set(BEAD.x * 1.035, BEAD.y * 1.03, BEAD.z * 1.12);
    cornea.renderOrder = 14;
    const lid = new THREE.Mesh(sphereGeo, lidMat);
    lid.scale.set(BEAD_LID.x, BEAD_LID.y, BEAD_LID.z);
    lid.receiveShadow = true;
    ball.add(bead, cornea);
    socket.add(ball, lid);
    headInner.add(socket);
    socket.updateMatrix(); lid.updateMatrix();
    lidMat.userData.u.uSockM.value.multiplyMatrices(socket.matrix, lid.matrix);   // unit-sphere vertex -> head space (the shell's scale included) lidMat.userData.u.uEyeO.value.copy(P);
    eyes.push({ side: s, socket, ball, bead, beadMat, lidMat, center: P.clone(), normal: N.clone() });
  }
  eyes.forEach((e, i) => U.uEyeC.value[i].copy(e.center));

  return { root, tiltG, tiltIn, squashG, content, head, headInner, bodyGeo, bodyPre, body, glowLight, sphereGeo, BEAD, eyes };
}
