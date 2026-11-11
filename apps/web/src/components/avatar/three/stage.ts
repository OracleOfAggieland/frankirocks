// Prototype franki.html 790-899 (section 5: renderer, camera, lights, environment, post), ported in WP2.
// Allowed edits E1, E3, E5, E9 (design note §1.3). Not ported: `fatal` and the WebGL 2 probe (793-800; the
// probe is in three-host.ts, the failure is EngineError("create")). The canvas comes from HostPart; the camera
// aspect and the bloom size come from `size` (E5).
import type * as THREE from "three";
import type { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import type { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { ConfigPart } from "./config";
import type { HostPart } from "./context";
import { notPorted } from "./errors";

export interface StagePart {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  CAM_BASE: THREE.Vector3;
  CAM_LOOK: THREE.Vector3;
  keyLight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  LAMP_I: number;
  lampLight: THREE.PointLight;
  arcLight: THREE.PointLight;
  makeStudioEnv(): THREE.Texture;
  bloomPass: UnrealBloomPass;
  gradePass: ShaderPass;
}

/** Throws EngineError("create") when the WebGL 2 renderer can't be made. */
export function createStage(rc: HostPart & ConfigPart): StagePart {
  return notPorted("createStage", rc);
}
