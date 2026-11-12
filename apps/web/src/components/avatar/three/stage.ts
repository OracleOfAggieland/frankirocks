// Prototype franki.html 790-899 (section 5: renderer, camera, lights, environment, post), ported in WP2.
// Allowed edits E1, E3, E5, E9 (design note §1.3). Not ported: `fatal` and the WebGL 2 probe (793-800; the
// probe is in three-host.ts, the failure is EngineError("create")). E5: the canvas comes from HostPart (the
// destructuring line replaces `const canvas = $('stage')`, 802); the camera aspect and the bloom size come from
// `size`. E1: parameter types on `box`, the return type of `makeStudioEnv`, and `as` casts in the env traverse
// (they strip to the prototype's expressions). The only other lines that are not the prototype's say `contract:`.
import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { ConfigPart } from "./config";
import type { HostPart } from "./context";
import { EngineError } from "./errors";

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

// contract: three's WebGLRenderer constructor throws when it can't make the context. That is EngineError("create"),
// contract: in place of the prototype's `fatal` page panel.
function rendererOrFail(make: () => THREE.WebGLRenderer): THREE.WebGLRenderer {
  try {
    return make();
  } catch (e) {
    throw new EngineError("create", e instanceof Error ? e.message : String(e));
  }
}

/** Throws EngineError("create") when the WebGL 2 renderer can't be made. */
export function createStage(rc: HostPart & ConfigPart): StagePart {
  const { canvas, size, recordError } = rc;

  // Template-literal continuation lines keep the prototype's column: their leading spaces are shader text.
  /* =====================================================================
     5. RENDERER, CAMERA, LIGHTS, ENVIRONMENT, POST
     ===================================================================== */
  const renderer = rendererOrFail(() => new THREE.WebGLRenderer({   // contract: rendererOrFail(() => …)
    canvas, antialias: true, outputBufferType: THREE.HalfFloatType,     // 4x MSAA HDR scene target + setEffects post
    powerPreference: 'high-performance', alpha: false, stencil: false,
  }));
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].map((s) => (s || '').trim()).filter(Boolean).join(' | ');
    recordError('shader', log || 'shader program failed to link');
    console.error('Franki shader error:', log);
  };
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;      // keeps the pastel mint's hue; hot cores roll off to white
  renderer.toneMappingExposure = 0.97;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;                // the frame loop sets needsUpdate, so the ladder's 'every' throttle really applies
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.matrixWorldAutoUpdate = false;                  // the frame loop updates world matrices once, before the effects that read them
  const camera = new THREE.PerspectiveCamera(30, size.w / size.h, 0.1, 60);
  const CAM_BASE = new THREE.Vector3(0.35, 1.52, 6.4);
  const CAM_LOOK = new THREE.Vector3(0, 1.30, 0);                // headroom for the taller mop and the celebrate rise
  camera.position.copy(CAM_BASE);
  camera.lookAt(CAM_LOOK);

  const keyLight = new THREE.DirectionalLight(0xFFE7C4, 2.5);
  keyLight.position.set(-3, 4.2, 4);
  keyLight.target.position.set(0, 1.25, 0);
  keyLight.castShadow = true;
  Object.assign(keyLight.shadow.camera, { left: -2.0, right: 2.0, top: 2.1, bottom: -2.1, near: 2, far: 13 });
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.radius = 4;
  keyLight.shadow.intensity = 0.8;
  const rimLight = new THREE.DirectionalLight(0xA8FFD0, 2.3);
  rimLight.position.set(2.6, 2.9, -3.2);
  rimLight.target = keyLight.target;
  const hemiLight = new THREE.HemisphereLight(0x9FD8C0, 0x1A120A, 0.35);
  const LAMP_I = 1.1;                                   // a gentle warm kicker from behind; strong enough to warm the rim, not to blow out the brass
  const lampLight = new THREE.PointLight(0xFFB45A, LAMP_I, 9, 2);
  lampLight.position.set(-3.0, 1.6, -3.0);
  const arcLight = new THREE.PointLight(0xFFD24D, 0, 1.2, 2);
  scene.add(keyLight, keyLight.target, rimLight, hemiLight, lampLight, arcLight);

  /** Procedural studio for reflections: a top-left softbox (the art's sheen), a mint rim strip, a warm low bounce for the brass. */
  function makeStudioEnv(): THREE.Texture {
    const env = new THREE.Scene(), O = new THREE.Vector3(0, 0, 0);
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vDir; void main(){ float y = vDir.y;
      vec3 top = vec3(0.16, 0.21, 0.20), hor = vec3(0.055, 0.075, 0.07), bot = vec3(0.018, 0.016, 0.014);
      vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.6)) : mix(hor, bot, pow(-y, 0.45));
      c += vec3(0.12, 0.07, 0.03) * pow(max(dot(vDir, normalize(vec3(-0.6, 0.15, -0.3))), 0.0), 6.0);
      gl_FragColor = vec4(c, 1.0); }`,
    })));
    const box = (w: number, h: number, hex: number, k: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide }));
      m.material.color.multiplyScalar(k); m.position.set(x, y, z); m.lookAt(O); env.add(m);
    };
    box(3.6, 2.6, 0xFFF1DD, 5.5, -3.4, 4.6, 4.4);   // key softbox, upper left front
    box(0.9, 5.5, 0xC9FFE6, 3.2, 5.0, 1.4, -3.4);   // mint rim strip, behind right
    box(6.0, 0.6, 0xFFC46B, 2.4, 0.0, -2.2, 4.0);   // warm low bounce: the gold kick on the bolts
    box(1.6, 1.6, 0xFFFFFF, 2.0, 3.6, 2.2, 4.2);    // small fill: the second catch-light
    box(2.4, 1.2, 0xFFB45A, 0.8, -4.5, 1.5, -2.5);  // the off-screen lamp
    const pm = new THREE.PMREMGenerator(renderer);
    const tex = pm.fromScene(env, 0.035).texture;
    pm.dispose();
    env.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).geometry.dispose(); ((o as THREE.Mesh).material as THREE.Material).dispose(); } });
    return tex;
  }
  scene.environment = makeStudioEnv();

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.w, size.h), 0.42, 0.45, 0.95);
  const GradeShader = {
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.025 }, uVignette: { value: 0.35 }, uCA: { value: 0.0015 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uCA; uniform vec2 uRes; varying vec2 vUv;
    float fk_hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec2 c = vUv - 0.5;
      vec2 ca = c * vec2(uRes.x / uRes.y, 1.0);
      float r2 = dot(c, c);
      vec2 off = c * uCA * r2 * 4.0;                                       // chromatic aberration grows toward the edges
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, base.g, texture2D(tDiffuse, vUv - off).b);
      float vr = length(ca) / length(vec2(0.5 * uRes.x / uRes.y, 0.5));   // 0 centre .. 1 corner
      col *= 1.0 - uVignette * smoothstep(0.55, 1.0, vr);
      float n = fk_hash(vUv * uRes + fract(uTime) * 97.0) - 0.5;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += col * n * uGrain * 2.0 / (1.0 + lum) + n * uGrain * 0.015;  // HDR-safe grain, mostly in the mids
      gl_FragColor = vec4(max(col, 0.0), base.a);
    }`,
  };
  const gradePass = new ShaderPass(GradeShader);
  renderer.setEffects([bloomPass, gradePass]);

  return { renderer, scene, camera, CAM_BASE, CAM_LOOK, keyLight, rimLight, hemiLight, LAMP_I, lampLight, arcLight, makeStudioEnv, bloomPass, gradePass };
}
