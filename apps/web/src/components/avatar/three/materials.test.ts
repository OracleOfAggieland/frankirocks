// WP3 (design note §8.1): the shared uniform bags and every material of franki.html 954-969 and 1036-1421.
// Every onBeforeCompile hook runs on three r187's ShaderLib source for its material type, and the SHA-256 of the
// vertex and fragment text it produces must equal the golden taken from the prototype itself (prototype lines
// evaluated in node with the same three, a stub renderer and the fake canvas below). A replace that silently
// missed, a GLSL edit or a reordered chain changes a hash. The flags, colours, cache keys, uniform names and
// uniform identity are pinned beside it: the bags are shared by reference, never copied.
import { createHash } from "node:crypto";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "./config";
import { createBodyMaterials } from "./materials-body";
import { createHairBrassMaterials } from "./materials-hair-brass";
import type { StagePart } from "./stage";
import { createUniforms } from "./uniforms";

const sha = (t: string | Uint8Array) => createHash("sha256").update(t).digest("hex");

/** A 2D canvas good enough for makeBrushTexture: fillRect with an rgb() fill, getImageData, putImageData. */
function fakeDocument() {
  const canvases: { width: number; height: number; data: Uint8ClampedArray }[] = [];
  return {
    canvases,
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`unexpected element ${tag}`);
      const cv = {
        width: 0,
        height: 0,
        data: new Uint8ClampedArray(0),
        getContext() {
          cv.data = new Uint8ClampedArray(cv.width * cv.height * 4);
          const data = cv.data;
          return {
            fillStyle: "",
            fillRect(x: number, y: number, w: number, h: number) {
              const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(this.fillStyle);
              if (!m) throw new Error(`unexpected fill ${this.fillStyle}`);
              for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
                const i = (yy * cv.width + xx) * 4;
                data[i] = +m[1]; data[i + 1] = +m[2]; data[i + 2] = +m[3]; data[i + 3] = 255;
              }
            },
            getImageData() { return { data: new Uint8ClampedArray(data) }; },
            putImageData(img: { data: Uint8ClampedArray }) { data.set(img.data); },
          };
        },
      };
      canvases.push(cv);
      return cv;
    },
  };
}

const MAX_ANISOTROPY = 16;
const stubStage = { renderer: { capabilities: { getMaxAnisotropy: () => MAX_ANISOTROPY } } } as unknown as StagePart;

let doc: ReturnType<typeof fakeDocument>;
beforeEach(() => {
  doc = fakeDocument();
  vi.stubGlobal("document", doc);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Builds the WP3 parts in the prototype's order, as buildRig does. */
function build() {
  const config = createConfig({ still: false, quality: "auto" });
  const uniforms = createUniforms();
  const rc = { ...config, ...uniforms, ...stubStage };
  const body = createBodyMaterials(rc);
  const hairBrass = createHairBrassMaterials(rc);
  return { uniforms, body, hairBrass };
}

const LIB: Record<string, string> = { MeshPhysicalMaterial: "physical", MeshBasicMaterial: "basic", MeshDepthMaterial: "depth" };

function runHook(m: THREE.Material) {
  const lib = THREE.ShaderLib[LIB[m.type]];
  const s = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
  return s;
}

const FLAG_KEYS = [
  "type", "transparent", "depthWrite", "depthTest", "colorWrite", "alphaToCoverage", "blending", "polygonOffset", "polygonOffsetFactor",
  "polygonOffsetUnits", "vertexColors", "side", "roughness", "metalness", "clearcoat", "clearcoatRoughness", "sheen", "sheenRoughness",
  "specularIntensity", "ior", "envMapIntensity", "emissiveIntensity", "anisotropy", "anisotropyRotation", "bumpScale", "depthPacking",
] as const;

function describeMat(m: THREE.Material) {
  const rec = m as unknown as Record<string, unknown>;
  const o: Record<string, unknown> = {};
  for (const k of FLAG_KEYS) if (rec[k] !== undefined) o[k] = rec[k];
  for (const k of ["color", "sheenColor", "emissive"]) if (rec[k]) o[k] = (rec[k] as THREE.Color).getHex();
  o.key = m.customProgramCacheKey();
  return o;
}

const BODY_U = [
  "uTime", "uHemAmp", "uHemPhase", "uHemLag", "uBreath", "uNub", "uHeadRot", "uHeadPivot", "uGlow", "uRim", "uHue", "uGhost", "uGlowShift",
  "uNoiseAmt", "uBlush", "uThink", "uLidCover", "uLidShut", "uBrowL", "uBrowR", "uEyeC", "uBoltC", "uHoles", "uScarA", "uScarB", "uScarC",
  "uKeyDirV", "uRimDirV", "uSssCol", "uCoreCol", "uRimHem", "uRimTop", "uThinkCol", "uGhostCol", "uShadowCol", "uBlushCol", "uBrowCol",
  "uScarCut", "uScarGroove", "uWeltCol", "uHoleCol",
];
const HAIR_U = ["uHairLag", "uHairA", "uKeyI", "uHairRoot", "uHairMid", "uHairTip", "uBounce"];
const BRASS_U = ["uBrassA", "uGlint", "uGlintPhase", "uBrassHi"];

// Goldens from the prototype (franki.html, three@0.187.0).
const PHYS_BASE = {
  type: "MeshPhysicalMaterial", depthTest: true, colorWrite: true, blending: THREE.NormalBlending, polygonOffset: false,
  polygonOffsetFactor: 0, polygonOffsetUnits: 0, vertexColors: false, side: THREE.FrontSide, metalness: 0, emissiveIntensity: 1,
  anisotropy: 0, anisotropyRotation: 0, bumpScale: 1, emissive: 0,
};
const GOLDEN = {
  bodyMat: {
    flags: {
      ...PHYS_BASE, transparent: true, depthWrite: false, alphaToCoverage: false, roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.27,
      sheen: 0.25, sheenRoughness: 0.5, specularIntensity: 0.55, ior: 1.38, envMapIntensity: 0.45, color: 14087631, sheenColor: 15399903,
      key: "fk-body-1",
    },
    vertex: "7f4de59687ea7c8810f2c8e9d17883559e93b6072be36469a73fa7e393df9877",
    fragment: "c71fa35e39e9e5599fa87c0b69dd34c988a1ee9f5698637057ec96135277dee8",
    uniforms: BODY_U,
  },
  bodyPreMat: {
    flags: {
      type: "MeshBasicMaterial", transparent: true, depthWrite: true, depthTest: true, colorWrite: false, alphaToCoverage: false,
      blending: THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, vertexColors: false,
      side: THREE.FrontSide, color: 16777215, key: "fk-body-pre-1",
    },
    vertex: "0ffcd602004909a51d3e9d93c29ee275978d314be63f7ab4a3ec9483569d1f04",
    fragment: "dffb0590521202bc3aee87ec745f0e58571f733ed03d5cdcfa80ae0554e4e2ab",
    uniforms: BODY_U,
  },
  bodyDepthMat: {
    flags: {
      type: "MeshDepthMaterial", transparent: false, depthWrite: true, depthTest: true, colorWrite: true, alphaToCoverage: false,
      blending: THREE.NormalBlending, polygonOffset: false, polygonOffsetFactor: 0, polygonOffsetUnits: 0, vertexColors: false,
      side: THREE.FrontSide, depthPacking: THREE.RGBADepthPacking, key: "fk-body-depth-1",
    },
    vertex: "1a8a5eafbfd1136bb5c27fb73aa5853bcb339a626d9ec425437ed3986a16c63b",
    fragment: "08541d654d77b3adda45a3efa4bae66f2dd1b8c34fd0bfc65c2c192444891b77",
    uniforms: BODY_U,
  },
  lidMat: {
    flags: {
      ...PHYS_BASE, transparent: false, depthWrite: true, alphaToCoverage: true, roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.27,
      sheen: 0.15, sheenRoughness: 0.5, specularIntensity: 0.55, ior: 1.38, envMapIntensity: 0.45, color: 14087631, sheenColor: 15399903,
      key: "fk-lid-1",
    },
    vertex: "9400306d73e8751bd372e7571df59f9b03aa1626dc25b6acd77806cd44bc68e6",
    fragment: "e76607adfb361c14dfe276e7d7564934bf6d289f7487f75781e161089fac6cca",
    uniforms: [...BODY_U, "uLid", "uOuter", "uSockM", "uEyeO"],
  },
  beadMat: {
    flags: {
      ...PHYS_BASE, transparent: false, depthWrite: true, alphaToCoverage: false, roughness: 0.22, clearcoat: 0.3, clearcoatRoughness: 0.12,
      sheen: 0, sheenRoughness: 1, specularIntensity: 0.3, ior: 1.5, envMapIntensity: 0.12, color: 526345, sheenColor: 0, key: "fk-bead-1",
    },
    vertex: "9c6a30279606495ce26d5ff60d01bac36fdac272fd4be8dceafa0e2f0685ac31",
    fragment: "66371f0f824112beed0304b6bfe25fd3230b1867855d23df2a9612679d18f989",
    uniforms: ["uGlow", "uGaze", "uPupil", "uLid", "uOuter", "uIris0", "uIris1", "uRimRefl"],
  },
  corneaMat: {
    flags: {
      ...PHYS_BASE, transparent: true, depthWrite: false, alphaToCoverage: false, blending: THREE.AdditiveBlending, roughness: 0.03,
      clearcoat: 1, clearcoatRoughness: 0.02, sheen: 0, sheenRoughness: 1, specularIntensity: 1, ior: 1.376, envMapIntensity: 0.3, color: 0,
      sheenColor: 0, key: "fk-cornea-1",
    },
    vertex: "d3257679d2240f665094a138945b9ea7741c3e661e5b9d4c461710823cbc8970",
    fragment: "7388924714d0e3431695399f7e588abdabade5ca402aae2f392bad8dae8d41a0",
    uniforms: ["uGhost"],
  },
  hairMat: {
    flags: {
      ...PHYS_BASE, transparent: true, depthWrite: true, alphaToCoverage: false, roughness: 0.6, clearcoat: 0, clearcoatRoughness: 0,
      sheen: 0.3, sheenRoughness: 0.45, specularIntensity: 0.2, ior: 1.5, envMapIntensity: 0.25, color: 3026740, sheenColor: 5263961,
      key: "fk-hair-1",
    },
    vertex: "b6cb542f9afbe0aa93119df151eaa578401ece337b066977119b048482dd5f7c",
    fragment: "0b8e57326ad2847bdcaa8629233d124522d7c8c4c41be44be3cf782270ac9969",
    uniforms: ["uGlow", "uKeyDirV", "uRimDirV", ...HAIR_U],
  },
  brassMat: {
    flags: {
      ...PHYS_BASE, transparent: true, depthWrite: true, alphaToCoverage: false, vertexColors: true, roughness: 0.42, metalness: 1,
      clearcoat: 0.2, clearcoatRoughness: 0.14, sheen: 0, sheenRoughness: 1, specularIntensity: 1, ior: 1.5, envMapIntensity: 1.5,
      emissiveIntensity: 0, anisotropy: 0.7, bumpScale: 0.005, color: 15254138, sheenColor: 0, emissive: 16747050, key: "fk-brass-1",
    },
    vertex: "2ca822a10e3360ab1fc7602560d56edb47c402912a81305eab02d7083c1ce374",
    fragment: "f0b8d235ab5ce8d6e60a98f69d4f791422bc224e151be1af5a0b4aae38da7c4d",
    uniforms: BRASS_U,
  },
} as const;
/** SHA-256 of JSON.stringify([U, hairU, brassU]) at construction: every initial value, in order. */
const GOLDEN_UNIFORM_VALUES = "797e6d7505865b2319aa6e4e3865c155741ff460b8b9b7f56317698df7f9ec37";
/** SHA-256 of the brush canvas's RGBA bytes after makeBrushTexture (mulberry32(77) draw order). */
const GOLDEN_BRUSH = "5da752a461636f3612db56a9e8dfce63b94311d2cf492a9225de24406d69c4ca";

function materialsOf(built: ReturnType<typeof build>) {
  const { body, hairBrass } = built;
  return {
    bodyMat: body.bodyMat, bodyPreMat: body.bodyPreMat, bodyDepthMat: body.bodyDepthMat,
    lidMat: body.makeLidMat(1), beadMat: body.makeBeadMat(1), corneaMat: body.corneaMat,
    hairMat: hairBrass.hairMat, brassMat: hairBrass.brassMat,
  };
}

describe("uniform bags", () => {
  it("hold the prototype's names in the prototype's order", () => {
    const { U, hairU, brassU } = createUniforms();
    expect(Object.keys(U)).toEqual(BODY_U);
    expect(Object.keys(U)).toHaveLength(41);
    expect(Object.keys(hairU)).toEqual(HAIR_U);
    expect(Object.keys(brassU)).toEqual(BRASS_U);
  });

  it("hold the prototype's initial values", () => {
    const { U, hairU, brassU } = createUniforms();
    expect(sha(JSON.stringify([U, hairU, brassU]))).toBe(GOLDEN_UNIFORM_VALUES);
  });

  it("are new objects for every engine, so two engines never share state", () => {
    const a = createUniforms();
    const b = createUniforms();
    expect(a.U).not.toBe(b.U);
    expect(a.U.uGlow).not.toBe(b.U.uGlow);
    expect(a.hairU.uHairLag).not.toBe(b.hairU.uHairLag);
    expect(a.brassU.uGlint).not.toBe(b.brassU.uGlint);
    expect(a.V3()).not.toBe(a.V3());
  });
});

describe("materials", () => {
  for (const name of Object.keys(GOLDEN) as (keyof typeof GOLDEN)[]) {
    it(`${name}: flags, colours and cache key equal the prototype's`, () => {
      const m = materialsOf(build())[name];
      expect(describeMat(m)).toEqual(GOLDEN[name].flags);
    });

    it(`${name}: onBeforeCompile output on r187's ShaderLib equals the prototype's`, () => {
      const m = materialsOf(build())[name];
      const lib = THREE.ShaderLib[LIB[m.type]];
      const s = runHook(m);
      expect(s.vertexShader !== lib.vertexShader || s.fragmentShader !== lib.fragmentShader).toBe(true);
      expect(sha(s.vertexShader)).toBe(GOLDEN[name].vertex);
      expect(sha(s.fragmentShader)).toBe(GOLDEN[name].fragment);
      expect(Object.keys(s.uniforms)).toEqual(GOLDEN[name].uniforms);
    });
  }

  it("cache keys are unique", () => {
    const keys = Object.values(materialsOf(build())).map((m) => m.customProgramCacheKey());
    // The lid and bead factories make one material per eye, sharing one program per kind.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("the depth material reuses the prepass hook itself", () => {
    const { body } = build();
    expect(body.bodyDepthMat.onBeforeCompile).toBe(body.bodyPreMat.onBeforeCompile);
  });

  it("are built in the prototype's order (material ids break ties in the opaque sort)", () => {
    const { body, hairBrass } = build();
    const ids = [body.bodyMat, body.bodyPreMat, body.bodyDepthMat, body.corneaMat, hairBrass.hairMat, hairBrass.brassMat].map((m) => m.id);
    expect(ids).toEqual(ids.map((_, i) => ids[0] + i));
  });

  it("BEAD_LID is the bead size times its lid scale", () => {
    const { body } = build();
    expect(body.BEAD_LID).toEqual({ x: 0.085 * 1.075, y: 0.17 * 1.05, z: 0.045 * 1.22 });
  });
});

describe("uniform identity", () => {
  it("every material holds the shared bags' own objects, never copies", () => {
    const built = build();
    const { U, hairU, brassU } = built.uniforms;
    const mats = materialsOf(built);
    const lid = mats.lidMat;
    const bead = mats.beadMat;
    const runs = Object.fromEntries(Object.entries(mats).map(([k, m]) => [k, runHook(m).uniforms]));
    const shared: Record<string, THREE.IUniform> = { ...U, ...hairU, ...brassU };
    for (const [name, uniforms] of Object.entries(runs)) {
      const own = (name === "lidMat" ? lid : name === "beadMat" ? bead : null)?.userData.u as Record<string, THREE.IUniform> | undefined;
      for (const [k, u] of Object.entries(uniforms)) {
        const expected = own && k in own ? own[k] : shared[k];
        expect(u, `${name}.${k}`).toBe(expected);
      }
    }
    // The same object reaches every material that reads it.
    expect(runs.bodyMat.uGlow).toBe(runs.hairMat.uGlow);
    expect(runs.bodyMat.uGlow).toBe(runs.beadMat.uGlow);
    expect(runs.lidMat.uGhost).toBe(runs.corneaMat.uGhost);
    expect(runs.bodyPreMat.uHeadRot).toBe(runs.bodyDepthMat.uHeadRot);
    expect(runs.hairMat.uKeyDirV).toBe(U.uKeyDirV);
  });

  it("each lid and bead has its own uniforms, so the two eyes act independently", () => {
    const { body } = build();
    const l1 = body.makeLidMat(-1), l2 = body.makeLidMat(1);
    const b1 = body.makeBeadMat(-1), b2 = body.makeBeadMat(1);
    expect(l1.userData.u.uLid).not.toBe(l2.userData.u.uLid);
    expect(l1.userData.u.uOuter.value).toBe(-1);
    expect(l2.userData.u.uOuter.value).toBe(1);
    expect(b1.userData.u.uGaze).not.toBe(b2.userData.u.uGaze);
    expect(b1.userData.u.uOuter.value).toBe(-1);
    expect(runHook(l1).uniforms.uLid).toBe(l1.userData.u.uLid);
    expect(runHook(b2).uniforms.uGaze).toBe(b2.userData.u.uGaze);
  });

  it("the brass bag reaches the brass material and the hair bag the hair material", () => {
    const built = build();
    expect(runHook(built.hairBrass.brassMat).uniforms.uGlint).toBe(built.uniforms.brassU.uGlint);
    expect(runHook(built.hairBrass.hairMat).uniforms.uHairLag).toBe(built.uniforms.hairU.uHairLag);
  });
});

describe("brush texture", () => {
  it("draws the prototype's 64 x 1024 brushing and is the brass roughness and bump map", () => {
    const { hairBrass } = build();
    expect(doc.canvases).toHaveLength(1);
    const cv = doc.canvases[0];
    expect([cv.width, cv.height]).toEqual([64, 1024]);
    expect(sha(new Uint8Array(cv.data.buffer))).toBe(GOLDEN_BRUSH);
    const t = hairBrass.brushTex;
    expect(t).toBeInstanceOf(THREE.CanvasTexture);
    expect(t.image).toBe(cv);
    expect([t.wrapS, t.wrapT]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping]);
    expect(t.anisotropy).toBe(MAX_ANISOTROPY);
    expect(hairBrass.brassMat.roughnessMap).toBe(t);
    expect(hairBrass.brassMat.bumpMap).toBe(t);
  });
});
