// Prototype franki.html 1306-1421 without `hairU` (1307-1310) and `brassU` (1384), which live in uniforms.ts:
// hairMat, makeBrushTexture, brushTex, brassMat. Ported in WP3. Allowed edits E1, E3, E9. The brush texture
// draws on a 2D canvas and reads renderer.capabilities, so this factory needs the stage.
import * as THREE from "three";
import { COL, type ConfigPart } from "./config";
import { GLSL_NOISE } from "./glsl";
import { clamp, mulberry32 } from "./math";
import type { StagePart } from "./stage";
import type { UniformsPart } from "./uniforms";

export interface HairBrassMaterialsPart {
  hairMat: THREE.MeshPhysicalMaterial;
  makeBrushTexture(): THREE.CanvasTexture;
  brushTex: THREE.CanvasTexture;
  brassMat: THREE.MeshPhysicalMaterial;
}

export function createHairBrassMaterials(rc: ConfigPart & UniformsPart & StagePart): HairBrassMaterialsPart {
  const { U, hairU, brassU, renderer } = rc;

  /* Hair:solid tufts with Kajiya-Kay strand highlights, a strand-noise albedo and a green bounce underneath. */
  const hairMat = new THREE.MeshPhysicalMaterial({
    color: COL.hairBase, roughness: 0.6, metalness: 0, sheen: 0.3, sheenColor: COL.hairSheen, sheenRoughness: 0.45,
    specularIntensity: 0.2, envMapIntensity: 0.25, transparent: true,
  });
  hairMat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uGlow: U.uGlow, uKeyDirV: U.uKeyDirV, uRimDirV: U.uRimDirV }, hairU);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aStrand; attribute vec3 aFlow; uniform vec3 uHairLag; varying vec3 vStrand; varying vec3 vFlowV;')
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
      transformed += uHairLag * aStrand.y * aStrand.y;                      // tips trail the head
      vStrand = aStrand;
      vFlowV = normalize((modelViewMatrix * vec4(aFlow, 0.0)).xyz + vec3(1e-6));`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE + /* glsl */`
      uniform vec3 uKeyDirV, uRimDirV, uHairRoot, uHairMid, uHairTip, uBounce; uniform float uGlow, uHairA, uKeyI;
      varying vec3 vStrand; varying vec3 vFlowV;
      float fk_strand(float x){ return fk_vnoise(vec3(x, 0.5, 1.5)) * 0.55 + fk_vnoise(vec3(x * 2.7, 3.1, 0.2)) * 0.3 + fk_vnoise(vec3(x * 7.3, 1.7, 4.4)) * 0.15; }`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      float fkS = fk_strand(vStrand.x);
      fkS = mix(fkS, 0.5, smoothstep(0.35, 1.4, fwidth(vStrand.x)));      // strands finer than a pixel fade to their mean: no moire or stair-steps
      {
        vec3 hc = mix(uHairRoot, uHairMid, smoothstep(0.0, 0.55, vStrand.y));
        hc = mix(hc, uHairTip, smoothstep(0.62, 1.0, vStrand.y) * 0.75);
        diffuseColor.rgb = hc * (0.78 + 0.44 * fkS) * mix(0.5, 1.0, vStrand.z);   // soft fur, not knitted stripes
      }`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = fk_bump(-vViewPosition, normal, fkS * 0.0016);')
      .replace('#include <opaque_fragment>', /* glsl */`
      {
        vec3 V = normalize(vViewPosition);
        vec3 T = normalize(vFlowV - normal * dot(vFlowV, normal) + vec3(1e-6));
        float sh = (fkS - 0.5) * 0.35;
        vec3 T1 = normalize(T + normal * (0.10 + sh)), T2 = normalize(T + normal * (-0.14 + sh));
        vec3 H1 = normalize(uKeyDirV + V), H2 = normalize(uRimDirV + V);
        float d1 = dot(T1, H1), d2 = dot(T2, H1), d3 = dot(T1, H2);
        float s1 = pow(sqrt(max(1.0 - d1 * d1, 0.0)), 90.0);                 // primary lobe: white, toward the root
        float s2 = pow(sqrt(max(1.0 - d2 * d2, 0.0)), 24.0) * (0.4 + fkS);   // secondary: warm, toward the tip, sparkly
        float s3 = pow(sqrt(max(1.0 - d3 * d3, 0.0)), 60.0) * saturate(dot(normal, uRimDirV) * 0.5 + 0.5);
        float occ = saturate(dot(normal, uKeyDirV) * 0.55 + 0.45) * vStrand.z;
        outgoingLight += (vec3(0.85, 0.9, 1.0) * s1 * 0.14 + vec3(0.72, 0.70, 0.68) * s2 * 0.09) * occ * uKeyI + vec3(0.55, 1.0, 0.75) * s3 * 0.16 * vStrand.z;
        vec3 nW = (vec4(normal, 0.0) * viewMatrix).xyz;
        outgoingLight += uBounce * saturate(-nW.y) * uGlow * 0.3;            // the ghost's glow bouncing up under the fringe
        diffuseColor.a = uHairA;
      }
      #include <opaque_fragment>`);
  };
  hairMat.customProgramCacheKey = () => 'fk-hair-1';

  /* Brushed brass. Lathe UVs run around the circumference, so r187's UV-derived anisotropy frame brushes concentric rings. */
  function makeBrushTexture() {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 1024;
    const g = cv.getContext('2d')!;
    const r = mulberry32(77);
    let drift = 0.5;
    for (let y = 0; y < 1024; y++) {
      drift += (r() - 0.5) * 0.04; drift = clamp(drift, 0.38, 0.62);
      let v = drift + (r() - 0.5) * 0.16;
      if (r() < 0.012) v = 0.25 + r() * 0.15;          // a polished scratch
      if (r() < 0.008) v = 0.85;                       // a dull scuff
      const c = Math.round(clamp(v) * 255);
      g.fillStyle = `rgb(${c},${c},${c})`; g.fillRect(0, y, 64, 1);
    }
    const img = g.getImageData(0, 0, 64, 1024);
    for (let i = 0; i < img.data.length; i += 4) {     // fine high-frequency grain for micro scratches
      const n = (r() - 0.5) * 18;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(img.data[i] + n, 0, 255);
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  const brushTex = makeBrushTexture();
  const brassMat = new THREE.MeshPhysicalMaterial({
    // Polished, not satin: a low roughness keeps a real metal gradient and a face highlight; the brush map only modulates it.
    color: COL.brassBase, metalness: 1, roughness: 0.42, roughnessMap: brushTex, bumpMap: brushTex, bumpScale: 0.005,   /* fine brushing, not ribs */
    anisotropy: 0.7, anisotropyRotation: 0, clearcoat: 0.2, clearcoatRoughness: 0.14, vertexColors: true,
    emissive: 0xFF8A2A, emissiveIntensity: 0, envMapIntensity: 1.5, transparent: true,
  });
  brassMat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, brassU);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart; varying float vPart; varying vec2 vBUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = aPart; vBUv = uv;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBrassA, uGlint, uGlintPhase; uniform vec3 uBrassHi; varying float vPart; varying vec2 vBUv;\nfloat fk_aD(float a, float b){ return abs(mod(a - b + PI, 2.0 * PI) - PI); }')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (vPart > 3.75) roughnessFactor = 0.3;   // staples: smooth wire, no brushed bands')
      .replace('#include <normal_fragment_maps>', 'if (vPart < 3.75) {\n#include <normal_fragment_maps>\n}')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_ANISOTROPY\nif (vPart > 3.75) material.anisotropy = 0.0;\n#endif')
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      {
        float hw = vPart > 3.75 ? 0.0 : vPart > 3.25 ? 0.75 : vPart > 2.5 ? 0.3 : vPart > 1.5 ? 0.8 : 0.2;   // heat lives in the cap rim and the shaft; staples never glow
        if (vPart > 2.5 && vPart < 3.75) hw *= mix(1.0, 0.12, smoothstep(0.6, 0.97, vBUv.y));   // the cap face cools from the rim inward
        float edge = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.5);
        totalEmissiveRadiance *= hw * (0.15 + 0.85 * edge);              // heated metal glows at its edges and keeps its reflections face-on
        float hot = saturate(hw * (0.35 + 0.9 * edge) * emissive.r * 0.6);   // emissive arrives pre-scaled by the intensity; its red channel is 1.0 x intensity
        totalEmissiveRadiance *= mix(vec3(0.95, 0.42, 0.22), vec3(1.0, 0.95, 0.75), hot);   // temper colours: dull red where it is cool, straw-gold where hottest
      }`)
      .replace('#include <opaque_fragment>', /* glsl */`
      {                                                                    // soft knee on lit brass, so a key-light streak never blooms into a hot ember
        vec3 lit = max(outgoingLight - totalEmissiveRadiance, 0.0);
        float pk = max(max(lit.r, lit.g), lit.b);
        if (pk > 0.8) lit *= (0.8 + (pk - 0.8) / (1.0 + (pk - 0.8) * 2.5)) / pk;
        outgoingLight = lit + totalEmissiveRadiance;
      }
      outgoingLight += uBrassHi * uGlint * exp(-pow(fk_aD(vBUv.x * 6.2831853, uGlintPhase) / 0.16, 2.0)) * smoothstep(3.2, 3.5, vPart);   // glint along the cap rim
      diffuseColor.a = uBrassA;
      #include <opaque_fragment>`);
  };
  brassMat.customProgramCacheKey = () => 'fk-brass-1';

  return { hairMat, makeBrushTexture, brushTex, brassMat };
}
