// WP5: the bolts, the staples, the merged brass mesh with its aPart ids, and the brass prepass (franki.html
// 1590-1727, 1990-1993). The goldens are the prototype's own numbers: its brass code, config, U and surface math
// evaluated in node with the repo's three@0.187.0 (a team tool kept outside the repo), copied here as
// literals because the repo cannot read the prototype. headInner is a bare Group and brassMat a bare material, as
// in the tool; neither changes the geometry. The merged checksums also pin the ported surface math (WP4).
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrass, createBrassPre } from "./brass";
import { createConfig } from "./config";
import { EngineError } from "./errors";
import { createSurface } from "./surface";
import { createUniforms } from "./uniforms";

type BrassRc = Parameters<typeof createBrass>[0];

function build(make: typeof createBrass = createBrass, makePre: typeof createBrassPre = createBrassPre) {
  const uniforms = createUniforms();
  const headInner = new THREE.Group();
  const brassMat = new THREE.MeshPhysicalMaterial();
  const rc = { ...createConfig({ still: false, quality: "auto" }), ...uniforms, ...createSurface(), headInner, brassMat } as unknown as BrassRc;
  const brass = make(rc);
  const pre = makePre({ ...rc, ...brass });
  return { U: uniforms.U, headInner, brassMat, brass, pre };
}

/** An order-sensitive weighted sum; the same code over the same Float32 data gives the same double. */
const sum = (arr: ArrayLike<number>) => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i] * (1 + (i % 13)); return s; };

function geoDigest(g: THREE.BufferGeometry) {
  const out: Record<string, unknown> = { count: g.attributes.position.count, indexed: g.index !== null, attributes: Object.keys(g.attributes) };
  for (const k of Object.keys(g.attributes)) out[k] = sum(g.attributes[k].array);
  const parts: Record<string, number> = {};
  if (g.attributes.aPart) for (const v of g.attributes.aPart.array) parts[v] = (parts[v] || 0) + 1;
  out.parts = parts;
  return out;
}

const v = (x: THREE.Vector2 | THREE.Vector3) => x.toArray();

const GOLD = {
  constants: { BOLT_R: 1.25, BOLT_L: 1.15, STAPLE_ARC: 2.670353755551324, STAPLE_R: 0.05, STAPLE_TUBE: 0.0155 },
  bolt: {
    count: 41556, indexed: false, attributes: ["position", "uv", "normal", "color", "aPart"],
    position: 29670.60904946203, uv: 417338.5330576021, normal: 38248.27794999123, color: 525389.6081786454, aPart: 586562,
    parts: { "0": 6144, "1": 276, "2": 24192, "3": 6336, "3.5": 4608 },
  },
  staple: {
    count: 3456, indexed: false, attributes: ["position", "normal", "uv", "color", "aPart"],
    position: 880.5785882494271, normal: -5.429517275412654, uv: 24185.72223695554, color: 65299.498270154, aPart: 96724,
    parts: { "4": 3456 },
  },
  brassGeo: {
    count: 93480, indexed: false, attributes: ["position", "uv", "normal", "color", "aPart"],
    position: 1030113.9044877955, uv: 907261.170926244, normal: -13362.482752295946, color: 1246740.40742144, aPart: 1463444.5,
    parts: { "0": 12288, "1": 552, "2": 48384, "3": 12672, "4": 10368, "3.5": 9216 },
  },
  bolts: [
    {
      side: -1,
      base: [-0.6084641535366742, 1.500832514217936, 0.0012513191854561353],
      axis: [-0.9921256653891765, -0.06937618482799908, -0.1042765987880083],
      tip: [-0.828095972712203, 1.4854743613016377, -0.021832912871239202],
      rim: [-0.7971305053146517, 1.6129449149772357, -0.01766184891971887],
      light: [-0.9669935658666877, 1.4757616954257178, -0.03643163670156037],
      color: 16765517, intensity: 0, distance: 1.4, decay: 2, flash: 0,
    },
    {
      side: 1,
      base: [0.6084641524372577, 1.5008325142175178, 0.0012513192426160929],
      axis: [0.9921256648909664, -0.06937618479316084, -0.1042766035513381],
      tip: [0.8280959715024954, 1.4854743613089318, -0.021832913868561378],
      rim: [0.7796913856888411, 1.3635539024181804, -0.017661849726507854],
      light: [0.9669935645872307, 1.4757616954378894, -0.03643163836574871],
      color: 16765517, intensity: 0, distance: 1.4, decay: 2, flash: 0,
    },
  ],
  uBoltC: [
    [-0.6084641535366742, 1.500832514217936, 0.0012513191854561353],
    [0.6084641524372577, 1.5008325142175178, 0.0012513192426160929],
  ],
  uHoles: [
    [0.23624120285662403, 1.585782847337993],
    [0.1876062363051968, 1.5285571526620074],
    [0.3612663318437419, 1.5342197045359875],
    [0.3056648605268298, 1.4808202954640124],
    [0.4825269637390567, 1.4690118967682795],
    [0.42012272729887473, 1.4197281032317204],
  ],
  scarAt: [[0.12, 1.585], [0.325, 1.51125], [0.52, 1.4]],
  children: [
    { type: "PointLight", renderOrder: 0, visible: true, castShadow: false, receiveShadow: false },
    { type: "PointLight", renderOrder: 0, visible: true, castShadow: false, receiveShadow: false },
    { type: "Mesh", renderOrder: 13, visible: true, castShadow: true, receiveShadow: true },
    { type: "Mesh", renderOrder: 12.5, visible: false, castShadow: false, receiveShadow: false },
  ],
  brassPreMat: { colorWrite: false, depthWrite: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 },
};

describe("brass (WP5)", () => {
  afterEach(() => {
    vi.doUnmock("three/addons/utils/BufferGeometryUtils.js");
    vi.resetModules();
  });

  it("keeps the prototype's bolt and staple constants", () => {
    const { brass } = build();
    expect({ BOLT_R: brass.BOLT_R, BOLT_L: brass.BOLT_L, STAPLE_ARC: brass.STAPLE_ARC, STAPLE_R: brass.STAPLE_R, STAPLE_TUBE: brass.STAPLE_TUBE }).toEqual(GOLD.constants);
  });

  it("builds the bolt and the staple exactly as the prototype does, with the aPart ids washer 0, nut 1, shaft 2, cap 3, cap rim 3.5, staple 4", () => {
    const { brass } = build();
    expect(geoDigest(brass.boltGeometry())).toEqual(GOLD.bolt);
    expect(geoDigest(brass.stapleGeometry())).toEqual(GOLD.staple);
  });

  it("merges two bolts and three staples into one brass mesh equal to the prototype's", () => {
    const { brass, brassMat } = build();
    expect(geoDigest(brass.brassGeo)).toEqual(GOLD.brassGeo);
    expect(brass.brass.geometry).toBe(brass.brassGeo);
    expect(brass.brass.material).toBe(brassMat);
  });

  it("places the bolts, their lights and rims as the prototype does", () => {
    const { brass } = build();
    expect(brass.bolts.map((b) => ({
      side: b.side, base: v(b.base), axis: v(b.axis), tip: v(b.tip), rim: v(b.rim), light: v(b.light.position),
      color: b.light.color.getHex(), intensity: b.light.intensity, distance: b.light.distance, decay: b.light.decay, flash: b.flash,
    }))).toEqual(GOLD.bolts);
  });

  it("writes uBoltC and the six staple leg holes into the shared U, in place", () => {
    const { U, brass } = build();
    expect(U.uBoltC.value.map(v)).toEqual(GOLD.uBoltC);
    expect(U.uHoles.value.map(v)).toEqual(GOLD.uHoles);
    expect(U.uBoltC.value[0]).not.toBe(brass.bolts[0].base);
    expect([0, 0.5, 1].map((t) => v(brass.scarAt(t)))).toEqual(GOLD.scarAt);
  });

  it("adds the two bolt lights, the brass mesh and, after the fur, the hidden prepass to headInner, in order", () => {
    const { headInner, brass, pre } = build();
    expect(headInner.children.map((c) => ({ type: c.type, renderOrder: c.renderOrder, visible: c.visible, castShadow: c.castShadow, receiveShadow: c.receiveShadow }))).toEqual(GOLD.children);
    expect(headInner.children[0]).toBe(brass.bolts[0].light);
    expect(headInner.children[1]).toBe(brass.bolts[1].light);
    expect(headInner.children[2]).toBe(brass.brass);
    expect(headInner.children[3]).toBe(pre.brassPre);
  });

  it("gives the prepass the shared brass geometry and a depth-only, polygon-offset material", () => {
    const { brass, pre } = build();
    expect(pre.brassPre.geometry).toBe(brass.brassGeo);
    expect(pre.brassPre.material).toBe(pre.brassPreMat);
    const m = pre.brassPreMat;
    expect({ colorWrite: m.colorWrite, depthWrite: m.depthWrite, transparent: m.transparent, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits }).toEqual(GOLD.brassPreMat);
    // No shader hook and no cache key of its own (map A 6.7).
    expect(Object.prototype.hasOwnProperty.call(m, "onBeforeCompile")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(m, "customProgramCacheKey")).toBe(false);
  });

  it("fails the brass merge as EngineError(\"merge\")", async () => {
    vi.resetModules();
    vi.doMock("three/addons/utils/BufferGeometryUtils.js", async (importOriginal) => {
      const real = await importOriginal<typeof import("three/addons/utils/BufferGeometryUtils.js")>();
      // The bolt merge (four parts) is real; the brass merge (two bolts and three staples) fails as three reports it.
      return { ...real, mergeGeometries: (gs: THREE.BufferGeometry[], useGroups?: boolean) => (gs.length === 5 ? null : real.mergeGeometries(gs, useGroups)) };
    });
    const mod = await import("./brass");
    const errors = await import("./errors");
    let caught: unknown;
    try {
      build(mod.createBrass, mod.createBrassPre);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(errors.EngineError);
    expect((caught as EngineError).reason).toBe("merge");
    expect((caught as EngineError).message).toBe("brass geometry merge failed");
  });
});
