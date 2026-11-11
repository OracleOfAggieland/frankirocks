// WP2 (design note §8.1): pins the four shared GLSL strings and every ShaderMaterial source built in stage.ts by
// SHA-256, and the stage's renderer, camera, light and post settings, against the prototype.
//
// The goldens were computed from the prototype's own text, not from this port: its template and string literals
// were evaluated in node (franki.html 904-952 and 971-1034 with EYE_X = 0.17; the env sphere's shaders at 853-858;
// GradeShader's at 880-896) and hashed as UTF-8. A changed byte in any shader fails here.
//
// stage.ts runs in node with the real three classes; only WebGLRenderer and PMREMGenerator are fakes, because both
// need a GL context. The fakes record what the stage asked of them.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  interface Recorded {
    params: unknown;
    effects: unknown[] | null;
  }
  return {
    renderers: [] as Recorded[],
    envScenes: [] as { scene: unknown; sigma: number }[],
    pmremDisposed: 0,
    throwOnCreate: null as Error | null,
  };
});

vi.mock("three", async (importOriginal) => {
  const real = await importOriginal<typeof import("three")>();
  class FakeWebGLRenderer {
    params: unknown;
    effects: unknown[] | null = null;
    debug: { onShaderError: unknown } = { onShaderError: null };
    shadowMap = { enabled: false, type: -1 as number, autoUpdate: true };
    info = { autoReset: true };
    outputColorSpace = "";
    toneMapping = -1 as number;
    toneMappingExposure = 1;
    constructor(params: unknown) {
      if (fakes.throwOnCreate) throw fakes.throwOnCreate;
      this.params = params;
      fakes.renderers.push(this);
    }
    setEffects(effects: unknown[] | null) {
      this.effects = effects;
    }
  }
  class FakePMREMGenerator {
    fromScene(scene: unknown, sigma: number) {
      fakes.envScenes.push({ scene, sigma });
      return { texture: new real.Texture() };
    }
    dispose() {
      fakes.pmremDisposed++;
    }
  }
  return { ...real, WebGLRenderer: FakeWebGLRenderer, PMREMGenerator: FakePMREMGenerator };
});

const THREE = await import("three");
const { GLSL_BODY_FRAG, GLSL_DISPLACE, GLSL_NOISE, GLSL_SKIN } = await import("./glsl");
const { createStage } = await import("./stage");
const { createConfig } = await import("./config");
const { EngineError } = await import("./errors");
type HostPart = import("./context").HostPart;

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const GOLDEN = {
  GLSL_NOISE: "8b144521e151364a2d299a7a613b7fcb53a197705b45ed78dc33a8fab41e16d3",
  GLSL_DISPLACE: "ddc38b20e739c485165edc12d193b0e5f2d4830e29cc6b3c441112944534440b",
  GLSL_SKIN: "fe99959e86565dd0eb774daa0a2e588657f5926bd7a2dca3b00943cb86aa4631",
  GLSL_BODY_FRAG: "95c954ca707a400b8ac0c8fca0bf507e23a9396db3b154fb08b43120722e2c8f",
  envVertex: "af6138f8f11d3a9c99bb9245008bf72574026baab2fa0aac91f8ddc89133855d",
  envFragment: "afee42f76f3f780d9ce958c00cdfbf5503446503472050c8383af08f3180aa51",
  gradeVertex: "c6d01d0fb2911d8ea12e2bd9e3841763d0f3fd28f92df4b77a0fd3fd6b0c3f4a",
  gradeFragment: "54dca9fe4829404f62bd4e86122211e81e9fb7acb4b2acab123564d9854976d3",
};

interface Recorded {
  kind: string;
  msg: string;
}

function hostPart(w: number, h: number) {
  const recorded: Recorded[] = [];
  const canvas = { tag: "the engine's canvas" };
  const rc = {
    canvas,
    size: { w, h },
    recordError: (kind: string, msg: string) => recorded.push({ kind, msg }),
  } as unknown as HostPart;
  return { rc: Object.assign(rc, createConfig({ still: false, quality: "auto" })), recorded, canvas };
}

beforeEach(() => {
  fakes.renderers.length = 0;
  fakes.envScenes.length = 0;
  fakes.pmremDisposed = 0;
  fakes.throwOnCreate = null;
});

describe("the shared GLSL strings (franki.html 904-952, 971-1034)", () => {
  it("are byte-identical to the prototype's, after interpolation", () => {
    expect({
      GLSL_NOISE: sha(GLSL_NOISE),
      GLSL_DISPLACE: sha(GLSL_DISPLACE),
      GLSL_SKIN: sha(GLSL_SKIN),
      GLSL_BODY_FRAG: sha(GLSL_BODY_FRAG),
    }).toEqual({
      GLSL_NOISE: GOLDEN.GLSL_NOISE,
      GLSL_DISPLACE: GOLDEN.GLSL_DISPLACE,
      GLSL_SKIN: GOLDEN.GLSL_SKIN,
      GLSL_BODY_FRAG: GOLDEN.GLSL_BODY_FRAG,
    });
  });

  it("interpolates EYE_X to three decimals in the brow, as at 1028", () => {
    expect(GLSL_BODY_FRAG).toContain("vec2 q = P - vec2(side * 0.170, 1.41 + B.y);");
  });
});

describe("createStage (franki.html 790-899)", () => {
  it("builds the env sphere and the grade pass from the prototype's shader sources", () => {
    const { rc } = hostPart(1280, 900);
    const stage = createStage(rc);
    expect(fakes.envScenes).toHaveLength(1);
    const env = fakes.envScenes[0].scene as InstanceType<typeof THREE.Scene>;
    const sphere = env.children[0] as InstanceType<typeof THREE.Mesh>;
    const envMat = sphere.material as InstanceType<typeof THREE.ShaderMaterial>;
    expect({
      envVertex: sha(envMat.vertexShader),
      envFragment: sha(envMat.fragmentShader),
      gradeVertex: sha(stage.gradePass.material.vertexShader),
      gradeFragment: sha(stage.gradePass.material.fragmentShader),
    }).toEqual({
      envVertex: GOLDEN.envVertex,
      envFragment: GOLDEN.envFragment,
      gradeVertex: GOLDEN.gradeVertex,
      gradeFragment: GOLDEN.gradeFragment,
    });
    expect(envMat.side).toBe(THREE.BackSide);
    expect(envMat.depthWrite).toBe(false);
  });

  it("makes the renderer on the host's canvas with the prototype's options and settings", () => {
    const { rc, canvas } = hostPart(1280, 900);
    const stage = createStage(rc);
    expect(fakes.renderers).toHaveLength(1);
    expect(fakes.renderers[0].params).toEqual({
      canvas,
      antialias: true,
      outputBufferType: THREE.HalfFloatType,
      powerPreference: "high-performance",
      alpha: false,
      stencil: false,
    });
    const r = stage.renderer as unknown as {
      outputColorSpace: string;
      toneMapping: number;
      toneMappingExposure: number;
      shadowMap: { enabled: boolean; type: number; autoUpdate: boolean };
      info: { autoReset: boolean };
    };
    expect(r.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(r.toneMapping).toBe(THREE.NeutralToneMapping);
    expect(r.toneMappingExposure).toBe(0.97);
    expect(r.shadowMap).toEqual({ enabled: true, type: THREE.PCFShadowMap, autoUpdate: false });
    expect(r.info.autoReset).toBe(false);
    expect(fakes.renderers[0].effects).toEqual([stage.bloomPass, stage.gradePass]);
    expect(fakes.renderers[0].effects?.[0]).toBe(stage.bloomPass);
    expect(fakes.renderers[0].effects?.[1]).toBe(stage.gradePass);
  });

  it("takes the camera aspect and the bloom size from the host's size (E5)", () => {
    const { rc } = hostPart(384, 422);
    const stage = createStage(rc);
    expect(stage.camera.fov).toBe(30);
    expect(stage.camera.aspect).toBe(384 / 422);
    expect(stage.camera.near).toBe(0.1);
    expect(stage.camera.far).toBe(60);
    expect(stage.camera.position.toArray()).toEqual([0.35, 1.52, 6.4]);
    expect(stage.CAM_BASE.toArray()).toEqual([0.35, 1.52, 6.4]);
    expect(stage.CAM_LOOK.toArray()).toEqual([0, 1.3, 0]);
    expect(stage.bloomPass.resolution.toArray()).toEqual([384, 422]);
    expect(stage.bloomPass.strength).toBe(0.42);
    expect(stage.bloomPass.radius).toBe(0.45);
    expect(stage.bloomPass.threshold).toBe(0.95);
  });

  it("keeps the prototype's lights, their order in the scene, and the grade uniforms", () => {
    const { rc } = hostPart(1280, 900);
    const s = createStage(rc);
    expect(s.scene.matrixWorldAutoUpdate).toBe(false);
    expect(s.scene.children).toEqual([s.keyLight, s.keyLight.target, s.rimLight, s.hemiLight, s.lampLight, s.arcLight]);
    expect(s.scene.children[0]).toBe(s.keyLight);
    expect(s.rimLight.target).toBe(s.keyLight.target);
    expect([s.keyLight.color.getHex(), s.keyLight.intensity]).toEqual([0xffe7c4, 2.5]);
    expect(s.keyLight.position.toArray()).toEqual([-3, 4.2, 4]);
    expect(s.keyLight.target.position.toArray()).toEqual([0, 1.25, 0]);
    expect(s.keyLight.castShadow).toBe(true);
    const sc = s.keyLight.shadow.camera;
    expect([sc.left, sc.right, sc.top, sc.bottom, sc.near, sc.far]).toEqual([-2.0, 2.0, 2.1, -2.1, 2, 13]);
    expect(s.keyLight.shadow.mapSize.toArray()).toEqual([2048, 2048]);
    expect([s.keyLight.shadow.bias, s.keyLight.shadow.normalBias, s.keyLight.shadow.radius, s.keyLight.shadow.intensity]).toEqual([
      -0.0004, 0.02, 4, 0.8,
    ]);
    expect([s.rimLight.color.getHex(), s.rimLight.intensity]).toEqual([0xa8ffd0, 2.3]);
    expect(s.rimLight.position.toArray()).toEqual([2.6, 2.9, -3.2]);
    expect([s.hemiLight.color.getHex(), s.hemiLight.groundColor.getHex(), s.hemiLight.intensity]).toEqual([0x9fd8c0, 0x1a120a, 0.35]);
    expect(s.LAMP_I).toBe(1.1);
    expect([s.lampLight.color.getHex(), s.lampLight.intensity, s.lampLight.distance, s.lampLight.decay]).toEqual([0xffb45a, 1.1, 9, 2]);
    expect(s.lampLight.position.toArray()).toEqual([-3.0, 1.6, -3.0]);
    expect([s.arcLight.color.getHex(), s.arcLight.intensity, s.arcLight.distance, s.arcLight.decay]).toEqual([0xffd24d, 0, 1.2, 2]);
    const u = s.gradePass.uniforms as Record<string, { value: unknown }>;
    expect([u.uTime.value, u.uGrain.value, u.uVignette.value, u.uCA.value]).toEqual([0, 0.025, 0.35, 0.0015]);
    expect((u.uRes.value as InstanceType<typeof THREE.Vector2>).toArray()).toEqual([1, 1]);
  });

  it("bakes the studio env once, at sigma 0.035, and frees the env scene's geometries and materials", () => {
    const { rc } = hostPart(1280, 900);
    const s = createStage(rc);
    expect(fakes.envScenes.map((e) => e.sigma)).toEqual([0.035]);
    expect(fakes.pmremDisposed).toBe(1);
    expect(s.scene.environment).toBeInstanceOf(THREE.Texture);
    const env = fakes.envScenes[0].scene as InstanceType<typeof THREE.Scene>;
    // The sphere, then the five boxes: key softbox, mint rim strip, warm low bounce, small fill, off-screen lamp.
    expect(env.children).toHaveLength(6);
    const boxes = env.children.slice(1) as InstanceType<typeof THREE.Mesh>[];
    const colors = boxes.map((m) => (m.material as InstanceType<typeof THREE.MeshBasicMaterial>).color.toArray());
    const expected = [
      [0xfff1dd, 5.5],
      [0xc9ffe6, 3.2],
      [0xffc46b, 2.4],
      [0xffffff, 2.0],
      [0xffb45a, 0.8],
    ].map(([hex, k]) => new THREE.Color(hex).multiplyScalar(k).toArray());
    expect(colors).toEqual(expected);
    expect(boxes.map((m) => m.position.toArray())).toEqual([
      [-3.4, 4.6, 4.4],
      [5.0, 1.4, -3.4],
      [0.0, -2.2, 4.0],
      [3.6, 2.2, 4.2],
      [-4.5, 1.5, -2.5],
    ]);
    // A fresh bake for a restored context gives a new texture and a new env scene.
    const again = s.makeStudioEnv();
    expect(again).not.toBe(s.scene.environment);
    expect(fakes.envScenes).toHaveLength(2);
  });

  it("records a shader error as 'shader', with the prototype's message when the logs are empty", () => {
    const { rc, recorded } = hostPart(1280, 900);
    const stage = createStage(rc);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onShaderError = stage.renderer.debug.onShaderError as unknown as (gl: unknown, p: unknown, vs: unknown, fs: unknown) => void;
    const logs = (program: string, vs: string, fs: string) => ({
      getProgramInfoLog: () => program,
      getShaderInfoLog: (s: string) => (s === "vs" ? vs : fs),
    });
    onShaderError(logs(" link failed ", "", "frag: bad"), {}, "vs", "fs");
    onShaderError(logs("", "", ""), {}, "vs", "fs");
    expect(recorded).toEqual([
      { kind: "shader", msg: "link failed | frag: bad" },
      { kind: "shader", msg: "shader program failed to link" },
    ]);
    errorSpy.mockRestore();
  });

  it("throws EngineError('create') when the renderer can't be made", () => {
    const { rc } = hostPart(1280, 900);
    fakes.throwOnCreate = new Error("Error creating WebGL context.");
    let caught: unknown = null;
    try {
      createStage(rc);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as InstanceType<typeof EngineError>).reason).toBe("create");
    expect((caught as Error).message).toBe("Error creating WebGL context.");
  });
});
