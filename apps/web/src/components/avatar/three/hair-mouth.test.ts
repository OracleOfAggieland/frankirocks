// WP6: the mop, the tufts, the hair prepass, the fur shells and the mouth (franki.html 1729-1988, 1995-2074). The
// goldens are the prototype's own numbers: its hair and mouth code, config, U, hairU and surface math evaluated in
// node with the repo's three@0.187.0 (team tool _sm/avatar/wp6/hair-mouth-goldens.mjs), copied here as literals
// because the repo cannot read the prototype. headInner is a bare Group and hairMat a bare material, as in the tool;
// neither changes the geometry. The tuft checksums pin the hrand draw order (HAIR_CELLS, then per fringe tuft the
// th jitter, the width and the seed, then per small tuft the same three, then one seed per side lock and wrap);
// the merged checksums also pin the ported surface math (WP4).
import { createHash } from "node:crypto";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "./config";
import type { EngineError } from "./errors";
import { createHair } from "./hair";
import { createMouth } from "./mouth";
import { createSurface } from "./surface";
import { createUniforms } from "./uniforms";

type HairRc = Parameters<typeof createHair>[0];

function build(make: typeof createHair = createHair) {
  const uniforms = createUniforms();
  const headInner = new THREE.Group();
  const hairMat = new THREE.MeshPhysicalMaterial();
  const rc = { ...createConfig({ still: false, quality: "auto" }), ...uniforms, ...createSurface(), headInner, hairMat } as unknown as HairRc;
  const hair = make(rc);
  const mouth = createMouth({ ...rc, ...hair });
  return { U: uniforms.U, hairU: uniforms.hairU, headInner, hairMat, hair, mouth };
}

/** The same order-sensitive weighted sum as the tool. */
const sum = (arr: ArrayLike<number>) => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i] * (1 + (i % 13)); return s; };

interface Digest {
  count: number;
  index: number | null;
  attributes: string[];
  indexSum?: number;
  [attribute: string]: unknown;
}

function geoDigest(g: THREE.BufferGeometry): Digest {
  const out: Digest = { count: g.attributes.position.count, index: g.index ? g.index.count : null, attributes: Object.keys(g.attributes) };
  if (g.index) out.indexSum = sum(g.index.array);
  for (const k of Object.keys(g.attributes)) out[k] = sum(g.attributes[k].array);
  return out;
}

/** Counts, attribute names and index sums are exact; float sums agree to 1e-9 of their size. */
function expectDigest(actual: Digest, gold: Digest) {
  expect({ count: actual.count, index: actual.index, attributes: actual.attributes, indexSum: actual.indexSum })
    .toEqual({ count: gold.count, index: gold.index, attributes: gold.attributes, indexSum: gold.indexSum });
  for (const k of gold.attributes) {
    const a = actual[k] as number, b = gold[k] as number;
    expect(Math.abs(a - b), `${k}: ${a} vs ${b}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const ATTRS = ["position", "aFlow", "aStrand", "normal"];
const tuft = (position: number, aFlow: number, aStrand: number, normal: number): Digest => ({
  count: 217, index: 1260, attributes: ATTRS, indexSum: 976196, position, aFlow, aStrand, normal,
});

const GOLD = {
  HAIR_CELLS: [
    0.5467061335220933, 0.27860878920182586, 0.9312369171530008, 0.5072224664036185, 0.668778280261904, 0.2878789729438722,
    0.25968898204155266, 0.4014227974694222, 0.344154309714213, 0.5877229548059404, 0.7312071544583887, 0.7544542800169438,
    0.6076078014448285, 0.9941590004600585, 0.3371317512355745, 0.7512016585096717, 0.8598654437810183, 0.2005152537021786,
    0.6422172551974654, 0.10701547958888113, 0.187082311604172, 0.22345856297761202, 0.12338943243958056, 0.21034441119991243,
    0.12514128256589174, 0.19698706944473088,
  ],
  constants: { PART_TH: -0.16, TUFT_H: 0.08, FUR_MAX: 5, FUR_LEN: 0.017 },
  hairEdgeAt: [-3, -2, -1.57, -0.5, 0, 0.4, 1.3, 2.2, 3],
  hairEdge: [1.5142715352185157, 1.5835358499137147, 1.6509320321281442, 1.728765419470051, 1.73, 1.719189246686559, 1.6869847762887487, 1.5820817696776819, 1.5284972510669956],
  hairTmaxAt: [-0.5, 0, 0.3, 0.7, 1, 1.5],
  hairTmax: [0.07, 0.07, 0.12097827956497426, 0.18401529641725703, 0.23, 0.23],
  cap: { count: 10388, index: 61380, attributes: ATTRS, indexSum: 2239230830, position: 135396.63694843822, aFlow: -25525.720620072792, aStrand: 106039.86053861864, normal: 39326.17848414475 },
  capLight: { count: 4984, index: 29250, attributes: ATTRS, indexSum: 512726997, position: 64861.78209028923, aFlow: -12492.395414016693, aStrand: 50578.48404079676, normal: 19436.642926262517 },
  tufts: [
    tuft(2135.472212690511, -1805.2458092337474, 44484.45047213137, -301.15768602560274),
    tuft(2358.335188877769, -1470.7052902234718, 28879.98238955438, -217.83771571837133),
    tuft(2660.7086887285113, -1036.125962762162, 7512.341519057751, -165.9552326303674),
    tuft(2979.185381596908, -691.4855607245117, 25264.44908569753, -237.0565850654384),
    tuft(3312.4399070607906, 793.6410582382232, 77181.05783678591, 44.69046676369908),
    tuft(3418.245940401219, 1218.8213062863797, 47132.572483316064, 174.12784140563235),
    tuft(3487.5316530968994, 1211.7178064621985, 55887.1669190079, 205.03341253323015),
    tuft(3528.2257322476944, 768.435879714787, 18414.992040994577, 80.34361972415354),
    tuft(3429.5804821951315, 187.51729030162096, 8108.735059097409, -34.01863176131155),
    tuft(2406.97801431641, -1383.9340849258006, 15821.782912123948, -316.53179472649936),
    tuft(3009.539201506297, -473.28203004272655, 50131.8049967438, -178.38011980056763),
    tuft(3476.8198873526417, 999.0067572821863, 67226.33625246584, 84.26165123831015),
    tuft(3568.901856292039, 675.8370852470398, 9940.253734350204, -20.067852340464015),
    tuft(2064.330550858751, -1726.2493713647127, 60611.48282648623, -330.3905447202269),
    tuft(1438.857085045427, -2190.980959944427, 65590.53019548953, -444.34842126630247),
    tuft(3569.490917947842, 53.776591705624014, 33730.922874704, -100.74733468610793),
    tuft(3015.749935749918, -1008.1537503674626, 67126.16435457766, -274.61178118517273),
  ],
  hair: { count: 14077, index: 82800, attributes: ATTRS, indexSum: 4073727145, position: 185300.17745849214, aFlow: -31331.316470991234, aStrand: 793814.6826730487, normal: 37378.10692322883 },
  furBase: { count: 8673, index: 50670, attributes: ATTRS, indexSum: 1536784081, position: 114783.7592487575, aFlow: -18307.389111867076, aStrand: 737740.5310899573, normal: 17625.586618638503 },
  furGeo: { instanceCount: 5, aShell: [0.20000000298023224, 0.4000000059604645, 0.6000000238418579, 0.800000011920929, 1], attributes: ["position", "normal", "aFlow", "aStrand", "aShell"], index: 50670 },
  mouth: { count: 1681, index: 9600, attributes: ["position", "aMouth"], indexSum: 56436117, position: 17236.715900775045, aMouth: -1.7660001385957003 },
  shaders: {
    furVertex: "7f193a890cc343b793a1719f1d6db6d45597112a677876409cc3bbf8e3e358a8",
    furFragment: "487a18c48dd5aaeb88f3085c9e3183ed3549ce2e65889ef05716c2297dd3e903",
    mouthVertex: "64e9c9dfba00070d5157ef1acbae8d3ee2e74f1eef8e817de7b22702ada957d5",
    mouthFragment: "262439ee9f5a30c86c307d1b8d50f37668dade2fb31f12d500dd0a9b19283948",
    hairPreVertex: "fc7b3825eef38d24f0280efe1cac8506e0f3880d468dc3f10d2f1e18a4544869",
    hairPreUniforms: ["uHairLag"],
    hairPreKey: "fk-hair-pre-1",
  },
  furMat: {
    alphaToCoverage: true, transparent: false, uFurN: 5,
    uniforms: ["uFurN", "uHairLag", "uHairA", "uKeyI", "uGlow", "uKeyDirV", "uRimDirV", "uHairRoot", "uHairMid", "uHairTip", "uBounce", "uThink", "uThinkCol"],
  },
  mouthMat: {
    transparent: true, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    uniforms: ["uShape", "uVis", "uTongue", "uGlow", "uIn", "uDeep", "uTongueC", "uTongueHi", "uSkin", "uGhost"],
    uShape: [0.1, 0, 0.01, 0.5],
    colours: [3021346, 1444880, 15043212, 16035758, 14087631],
  },
  hairPreMat: { colorWrite: false, depthWrite: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 },
  children: [
    { type: "Mesh", renderOrder: 12, visible: true, castShadow: true, receiveShadow: true, frustumCulled: true },
    { type: "Mesh", renderOrder: 11.5, visible: false, castShadow: false, receiveShadow: false, frustumCulled: true },
    { type: "Mesh", renderOrder: 0, visible: true, castShadow: false, receiveShadow: false, frustumCulled: false },
    { type: "Mesh", renderOrder: 11, visible: true, castShadow: false, receiveShadow: false, frustumCulled: true },
  ],
};

afterEach(() => {
  vi.doUnmock("three/addons/utils/BufferGeometryUtils.js");
  vi.resetModules();
});

describe("hair (franki.html 1729-1988)", () => {
  it("draws HAIR_CELLS as the first 26 values of mulberry32(4242), afresh for every engine", () => {
    const a = build().hair, b = build().hair;
    expect(a.HAIR_CELLS).toEqual(GOLD.HAIR_CELLS);
    expect(b.HAIR_CELLS).toEqual(GOLD.HAIR_CELLS);
    expect(b.HAIR_CELLS).not.toBe(a.HAIR_CELLS);
    expect({ PART_TH: a.PART_TH, TUFT_H: a.TUFT_H, FUR_MAX: a.FUR_MAX, FUR_LEN: a.FUR_LEN }).toEqual(GOLD.constants);
  });

  it("keeps the hairline and the mop thickness of the prototype", () => {
    const { hair } = build();
    expect(GOLD.hairEdgeAt.map((t) => hair.hairEdge(t))).toEqual(GOLD.hairEdge);
    expect(GOLD.hairTmaxAt.map((n) => hair.hairTmax(n))).toEqual(GOLD.hairTmax);
  });

  it("grows the mop cap, full and light, equal to the prototype's", () => {
    const { hair } = build();
    expectDigest(geoDigest(hair.buildHairCap()), GOLD.cap);
    expectDigest(geoDigest(hair.buildHairCap(150, 32)), GOLD.capLight);
  });

  it("builds the 17 tufts in the prototype's hrand draw order", () => {
    const { hair } = build();
    expect(hair.hairTufts).toHaveLength(GOLD.tufts.length);
    hair.hairTufts.forEach((g, i) => expectDigest(geoDigest(g), GOLD.tufts[i]));
  });

  it("a second engine grows the same hair, so no stream continues across builds", () => {
    build();
    const { hair } = build();
    hair.hairTufts.forEach((g, i) => expectDigest(geoDigest(g), GOLD.tufts[i]));
    expectDigest(geoDigest(hair.hair.geometry), GOLD.hair);
  });

  it("merges the cap and the tufts into one hair mesh on hairMat", () => {
    const { hair, hairMat } = build();
    expectDigest(geoDigest(hair.hair.geometry), GOLD.hair);
    expect(hair.hair.material).toBe(hairMat);
  });

  it("gives the depth prepass the hair's own geometry, its tip lag hook and cache key", () => {
    const { hair, hairU } = build();
    expect(hair.hairPre.geometry).toBe(hair.hair.geometry);
    expect(hair.hairPre.material).toBe(hair.hairPreMat);
    const m = hair.hairPreMat;
    expect({ colorWrite: m.colorWrite, depthWrite: m.depthWrite, transparent: m.transparent, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits }).toEqual(GOLD.hairPreMat);
    expect(m.customProgramCacheKey()).toBe(GOLD.shaders.hairPreKey);
    const s = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
    m.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(sha(s.vertexShader)).toBe(GOLD.shaders.hairPreVertex);
    expect(Object.keys(s.uniforms)).toEqual(GOLD.shaders.hairPreUniforms);
    expect(s.uniforms.uHairLag).toBe(hairU.uHairLag);
  });

  it("builds the fur shells over a lighter cap and the same tufts, one instanced draw", () => {
    const { hair } = build();
    expectDigest(geoDigest(hair.furBase), GOLD.furBase);
    const g = hair.furGeo;
    expect({ instanceCount: g.instanceCount, aShell: Array.from(g.attributes.aShell.array), attributes: Object.keys(g.attributes), index: g.index?.count }).toEqual(GOLD.furGeo);
    expect(g.index).toBe(hair.furBase.index);
    for (const name of ["position", "normal", "aFlow", "aStrand"]) expect(g.attributes[name]).toBe(hair.furBase.attributes[name]);
    expect(hair.fur.geometry).toBe(g);
    expect(hair.fur.material).toBe(hair.furMat);
  });

  it("keeps the fur shader source, flags and shared uniforms", () => {
    const { hair, U, hairU } = build();
    const m = hair.furMat;
    expect(sha(m.vertexShader)).toBe(GOLD.shaders.furVertex);
    expect(sha(m.fragmentShader)).toBe(GOLD.shaders.furFragment);
    expect({ alphaToCoverage: m.alphaToCoverage, transparent: m.transparent, uniforms: Object.keys(m.uniforms), uFurN: m.uniforms.uFurN.value }).toEqual(GOLD.furMat);
    for (const k of ["uHairLag", "uHairA", "uKeyI", "uHairRoot", "uHairMid", "uHairTip", "uBounce"] as const) expect(m.uniforms[k]).toBe(hairU[k]);
    for (const k of ["uGlow", "uKeyDirV", "uRimDirV", "uThink", "uThinkCol"] as const) expect(m.uniforms[k]).toBe(U[k]);
  });

  it("fails the hair merge as EngineError(\"merge\")", async () => {
    const caught = await buildWithFailingMerge(1);
    expect((caught as EngineError).name).toBe("EngineError");
    expect((caught as EngineError).reason).toBe("merge");
    expect((caught as EngineError).message).toBe("hair geometry merge failed");
  });

  it("fails the fur merge as EngineError(\"merge\")", async () => {
    const caught = await buildWithFailingMerge(2);
    expect((caught as EngineError).name).toBe("EngineError");
    expect((caught as EngineError).reason).toBe("merge");
    expect((caught as EngineError).message).toBe("fur geometry merge failed");
  });
});

/** Builds with the nth mergeGeometries call returning null, as three reports a failed merge. */
async function buildWithFailingMerge(nth: number): Promise<unknown> {
  vi.resetModules();
  let calls = 0;
  vi.doMock("three/addons/utils/BufferGeometryUtils.js", async (importOriginal) => {
    const real = await importOriginal<typeof import("three/addons/utils/BufferGeometryUtils.js")>();
    return { ...real, mergeGeometries: (gs: THREE.BufferGeometry[], useGroups?: boolean) => (++calls === nth ? null : real.mergeGeometries(gs, useGroups)) };
  });
  const mod = await import("./hair");
  const errors = await import("./errors");
  let caught: unknown;
  try {
    build(mod.createHair);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(errors.EngineError);
  return caught;
}

describe("mouth (franki.html 1995-2074)", () => {
  it("conforms the patch to the face, equal to the prototype's", () => {
    const { mouth } = build();
    expectDigest(geoDigest(mouth.mouth.geometry), GOLD.mouth);
    expectDigest(geoDigest(mouth.buildMouthGeometry()), GOLD.mouth);
    expect(mouth.mouth.material).toBe(mouth.mouthMat);
  });

  it("keeps the mouth shader source, premultiplied flags and shared uniforms", () => {
    const { mouth, U } = build();
    const m = mouth.mouthMat;
    expect(sha(m.vertexShader)).toBe(GOLD.shaders.mouthVertex);
    expect(sha(m.fragmentShader)).toBe(GOLD.shaders.mouthFragment);
    expect({
      transparent: m.transparent, premultipliedAlpha: m.premultipliedAlpha, depthWrite: m.depthWrite, polygonOffset: m.polygonOffset,
      polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits, uniforms: Object.keys(m.uniforms),
      uShape: (m.uniforms.uShape.value as THREE.Vector4).toArray(),
      colours: ["uIn", "uDeep", "uTongueC", "uTongueHi", "uSkin"].map((k) => (m.uniforms[k].value as THREE.Color).getHex()),
    }).toEqual(GOLD.mouthMat);
    expect(m.uniforms.uGlow).toBe(U.uGlow);
    expect(m.uniforms.uGhost).toBe(U.uGhost);
  });
});

describe("draw order", () => {
  it("adds the hair, the hidden prepass, the fur and the mouth to headInner, in order, with their render orders", () => {
    const { headInner, hair, mouth } = build();
    const order = [hair.hair, hair.hairPre, hair.fur, mouth.mouth];
    expect(headInner.children).toHaveLength(order.length);
    order.forEach((o, i) => expect(headInner.children[i]).toBe(o));
    expect(headInner.children.map((c) => ({ type: c.type, renderOrder: c.renderOrder, visible: c.visible, castShadow: c.castShadow, receiveShadow: c.receiveShadow, frustumCulled: c.frustumCulled }))).toEqual(GOLD.children);
  });
});
