// Prototype franki.html 1036-1304 (section 6: injectCommon, body, prepass, depth, lid, bead and cornea
// materials), ported in WP3. Allowed edits E1, E3, E9. Construction order is part of the look (material ids
// break ties in the opaque sort): bodyMat, bodyPreMat, bodyDepthMat, then the factories, then corneaMat.
// No renderer: node-testable.
import * as THREE from "three";
import { C, COL, type ConfigPart } from "./config";
import { GLSL_BODY_FRAG, GLSL_DISPLACE, GLSL_NOISE, GLSL_SKIN } from "./glsl";
import type { UniformsPart } from "./uniforms";

export interface BodyMaterialsPart {
  injectCommon(s: THREE.WebGLProgramParametersWithUniforms, extraVert?: string): void;
  bodyMat: THREE.MeshPhysicalMaterial;
  bodyPreMat: THREE.MeshBasicMaterial;
  bodyDepthMat: THREE.MeshDepthMaterial;
  /** Read by fx-catch.ts at 2516 as well. */
  BEAD_LID: { x: number; y: number; z: number };
  makeLidMat(outer: number): THREE.MeshPhysicalMaterial;
  makeBeadMat(outer: number): THREE.MeshPhysicalMaterial;
  corneaMat: THREE.MeshPhysicalMaterial;
}

export function createBodyMaterials(rc: ConfigPart & UniformsPart): BodyMaterialsPart {
  const { U } = rc;

  function injectCommon(s: THREE.WebGLProgramParametersWithUniforms, extraVert?: string) {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_DISPLACE + (extraVert || ''));
  }

  /* Body: physical base (clearcoat vinyl, sheen) plus the custom skin terms above. Always transparent so ghost mode never recompiles. */
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: COL.body, roughness: 0.34, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.27,   // a broad vinyl sheen, as in the art, not a pinpoint
    sheen: 0.25, sheenColor: COL.core, sheenRoughness: 0.5, specularIntensity: 0.55, ior: 1.38,
    envMapIntensity: 0.45, transparent: true, depthWrite: false,
  });
  bodyMat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    injectCommon(s, '\nvarying vec3 vObjPos;\nvarying vec3 vObjN;');
    s.vertexShader = s.vertexShader
      .replace('#include <beginnormal_vertex>', /* glsl */`#include <beginnormal_vertex>
      { vec3 n0 = normalize(objectNormal);
        vec3 t1 = normalize(cross(n0, abs(n0.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 t2 = cross(n0, t1);
        const float e = 0.003;                                            // finite-difference normal; cross(t1,t2) = n0 keeps the sign
        vec3 d0 = fk_displace(position), d1 = fk_displace(position + t1 * e), d2 = fk_displace(position + t2 * e);
        vec3 nn = cross(d1 - d0, d2 - d0);
        objectNormal = dot(nn, nn) > 1e-14 ? normalize(nn) : n0; }`)
      .replace('#include <begin_vertex>', 'vec3 transformed = fk_displace(position);\nvObjPos = position;\nvObjN = normal;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE + GLSL_SKIN + GLSL_BODY_FRAG)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      float fkH = 0.0, fkScarH = 0.0, fkAO = 1.0, fkCut = 0.0, fkBl = 0.0;
      {
        vec3 P = vObjPos;
        float th = atan(P.x, P.z / 0.86);
        vec2 au = vec2(th * 0.69, P.y);                                   // arc-length surface coordinates
        if (P.z > 0.0 && au.x > 0.04 && au.x < 0.62 && au.y > 1.33 && au.y < 1.66) {
          float d = fk_sdBezier(au, uScarA, uScarB, uScarC);
          vec2 ca = uScarC - uScarA;
          float tt = clamp(dot(au - uScarA, ca) / dot(ca, ca), 0.0, 1.0);
          float taper = smoothstep(0.0, 0.07, tt) * (1.0 - smoothstep(0.93, 1.0, tt));
          float groove = exp(-pow(d / 0.0095, 2.0)) * taper;             // about 0.02 wide
          float welt = exp(-fk_sq((d - 0.018) / 0.007)) * taper;
          fkScarH = -0.012 * groove + 0.0035 * welt;
          fkCut = smoothstep(0.05, 0.6, groove);
          diffuseColor.rgb = mix(diffuseColor.rgb, uWeltCol, welt * 0.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, uScarCut, smoothstep(0.08, 0.45, groove));
          diffuseColor.rgb = mix(diffuseColor.rgb, uScarGroove, smoothstep(0.65, 1.0, groove));
          fkAO *= 1.0 - 0.35 * groove;
          for (int i = 0; i < 6; i++) {
            float dh = length(au - uHoles[i]);
            float hole = exp(-pow(dh / 0.008, 2.0)), rim = exp(-fk_sq((dh - 0.011) / 0.0035));
            fkScarH -= 0.004 * hole;
            diffuseColor.rgb = mix(diffuseColor.rgb, uHoleCol * 0.8, max(rim * 0.55, hole * 0.85));
            fkAO *= 1.0 - 0.45 * hole;
          }
          for (int i = 0; i < 3; i++) {                                    // contact shadow under each staple
            vec2 a = uHoles[i * 2], ba = uHoles[i * 2 + 1] - a, pa = au - a;
            float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            fkAO *= 1.0 - 0.38 * exp(-pow(length(pa - ba * hh) / 0.014, 2.0));
          }
        }
        fkH += fkScarH;
        if (P.z > 0.15) {
          float bA = max(fk_brow(P.xy, -1.0, uBrowR), fk_brow(P.xy, 1.0, uBrowL));
          diffuseColor.rgb = mix(diffuseColor.rgb, uBrowCol, bA * 0.85);
          for (int i = 0; i < 2; i++) {
            float side = i == 0 ? -1.0 : 1.0;
            float bd = length((P.xy - vec2(side * 0.30, 1.10)) / vec2(0.11, 0.075));
            float bl = uBlush * exp(-bd * bd * 2.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, uBlushCol, bl);
            fkBl = max(fkBl, bl);
          }
        }
        for (int i = 0; i < 2; i++) {
          vec3 q = (P - uEyeC[i]) / vec3(0.125, 0.23, 0.14);
          fkAO *= 1.0 - 0.35 * (1.0 - 0.6 * uLidCover) * exp(-dot(q, q) * 1.3);   // eye sockets (shallower while a lid covers the bead)
          float db = length(P - uBoltC[i]);
          fkAO *= 1.0 - 0.5 * exp(-pow(db / 0.19, 2.0));                   // bolt washers
        }
        fkAO *= 1.0 - 0.42 * smoothstep(1.58, 1.74, P.y);                  // contact shade just under the hairline
        float crease = exp(-pow(fk_angD(th, 1.75) / 0.36, 2.0)) + exp(-pow(fk_angD(th, -1.75) / 0.36, 2.0));
        fkAO *= 1.0 - 0.32 * crease * exp(-fk_sq((P.y - 0.44) / 0.07));     // under the arm nubs
        fkAO *= mix(1.0, 0.55, saturate(-vObjN.y) * (1.0 - smoothstep(0.05, 0.36, P.y)));   // hem underside
        diffuseColor.rgb *= 1.0 + 0.012 * (fk_vnoise(P * 22.0) - 0.5);    // a tiny albedo mottle
        diffuseColor.rgb = mix(diffuseColor.rgb, uShadowCol, (1.0 - fkAO) * 0.6);
      }`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
      if (uNoiseAmt > 0.0) fkH += (fk_fbm3(vObjPos * 6.0 + vec3(0.0, uTime * 0.02, 0.0)) - 0.5) * uNoiseAmt;
      normal = fk_bump(-vViewPosition, normal, fkH);`)
      .replace('#include <clearcoat_normal_fragment_maps>', /* glsl */`#include <clearcoat_normal_fragment_maps>
      #ifdef USE_CLEARCOAT
        clearcoatNormal = fk_bump(-vViewPosition, clearcoatNormal, fkScarH);
      #endif`)
      .replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
      reflectedLight.indirectDiffuse *= fkAO;
      reflectedLight.indirectSpecular *= mix(1.0, fkAO, 0.7);`)
      .replace('#include <opaque_fragment>', /* glsl */`
      {
        vec3 Vv = normalize(vViewPosition);
        float fres;
        outgoingLight += fk_skinAdd(normal, Vv, vObjPos.y, fkAO, fres) * (1.0 - 0.85 * fkCut) * mix(vec3(1.0), uBlushCol * 1.1, fkBl * 0.85);   // the glow shines through the blush, so the cheeks still read warm   // the cut is a real dark seam: the inner glow does not shine out of it
        {                                                                  // soft knee: the face stays under the bloom threshold (no haze over the eyes); only edges may glow past it
          float NdV2 = saturate(dot(normal, Vv));
          float lim = mix(1.7, 1.02, smoothstep(0.15, 0.6, NdV2)), kn = lim * 0.72;
          float pk = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
          if (pk > kn) outgoingLight *= (kn + (pk - kn) / (1.0 + (pk - kn) / (lim - kn))) / pk;
        }
        outgoingLight = fk_hue(outgoingLight, uHue);
        float wisp = fk_vnoise(vec3(vObjPos.x * 3.2, vObjPos.y * 2.2 - uTime * 0.33, vObjPos.z * 3.2));
        float gl = clamp(uGhost * 2.2 - 0.6 * (vObjPos.y / 1.9) - 0.3 + (wisp - 0.5) * 1.0, 0.0, 1.0);   // dissolve rises from the hem
        float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
        outgoingLight = mix(outgoingLight, mix(vec3(lum), uGhostCol * lum * 1.2, 0.65), gl * 0.6);
        outgoingLight *= mix(1.0, 0.85, gl);
        float fresG = pow(1.0 - saturate(dot(normal, Vv)), 1.8);
        fresG *= 1.0 - 0.8 * smoothstep(1.60, 1.72, vObjPos.y);               // under the see-through hair cap the outline would read as a glowing headband
        outgoingLight += uGhostCol * (0.12 + 0.10 * wisp + 1.35 * fresG) * gl;    // a bright ecto outline and a faint inner glow: a spirit, not murky glass
        float ga = mix(0.3, 1.0, saturate(fresG * 1.6)) + 0.2 * (wisp - 0.5);   // see-through core, solid glowing edge
        diffuseColor.a = mix(1.0, saturate(ga), gl);
      }
      #include <opaque_fragment>`);
  };
  bodyMat.customProgramCacheKey = () => 'fk-body-1';

  // Depth prepass, in the transparent queue (after the ground at -50, before the body colour pass at 10): only the nearest body surface
  // gets coloured, and the floor and its glow pool still show through the ghost's hem.
  const bodyPreMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  bodyPreMat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    injectCommon(s);
    s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = fk_displace(position);');
  };
  bodyPreMat.customProgramCacheKey = () => 'fk-body-pre-1';

  const bodyDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  bodyDepthMat.onBeforeCompile = bodyPreMat.onBeforeCompile;
  bodyDepthMat.customProgramCacheKey = () => 'fk-body-depth-1';

  /* Eyelid shell: skin-matched, covers the bead where the lid is; alpha-to-coverage gives MSAA-smooth lid edges. */
  const BEAD_LID = { x: 0.085 * 1.075, y: 0.17 * 1.05, z: 0.045 * 1.22 };   // the shell's size (BEAD times its lid scale, below)
  function makeLidMat(outer: number) {
    const own = { uLid: { value: new THREE.Vector4(0.08, 0, 0, 0) }, uOuter: { value: outer }, uSockM: { value: new THREE.Matrix4() }, uEyeO: { value: new THREE.Vector3() } };
    const m = new THREE.MeshPhysicalMaterial({
      // The same surface as the face around it (body values), so a closing lid reads as skin, not a raised oval glued on.
      color: COL.body, roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.27, sheen: 0.15, sheenColor: COL.core, sheenRoughness: 0.5,
      specularIntensity: 0.55, ior: 1.38, envMapIntensity: 0.45, alphaToCoverage: true,
    });
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, U, own);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uSockM; varying vec3 vLidP; varying vec3 vFaceN; varying vec3 vHeadP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLidP = position; vFaceN = normalize(normalMatrix * vec3(0.0, 0.0, 1.0)); vHeadP = (uSockM * vec4(position, 1.0)).xyz;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_NOISE + GLSL_SKIN + '\nuniform vec4 uLid; uniform float uOuter; uniform vec3 uEyeO; varying vec3 vLidP; varying vec3 vFaceN; varying vec3 vHeadP;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, normalize(vFaceN), 0.95));   // shade the lid like the face around it: a closed eye, not an egg glued on')
        .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nclearcoatNormal = normalize(mix(clearcoatNormal, normalize(vFaceN), 0.95));   // and its gloss, or the shell\'s dome shows as a highlight\n#endif')
        .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        float fkLidA, fkLidAO = 1.0;
        {
          float x = vLidP.x, y = vLidP.y;
          float top = fk_lidTop(x, uLid, uOuter), bot = fk_lidBot(x, uLid);
          float aa = fwidth(y) * 1.25 + 0.006;
          float cT = smoothstep(top - aa, top + aa, y);
          float cB = 1.0 - smoothstep(bot - aa, bot + aa, y);
          fkLidA = max(max(cT, cB), smoothstep(-0.02, 0.04, bot - top));
          float eT = exp(-max(y - top, 0.0) / 0.06) * cT;                    // lid-edge thickness reads as a soft dark line
          float eB = exp(-max(bot - y, 0.0) / 0.05) * cB;
          diffuseColor.rgb *= 1.0 - 0.12 * eT - 0.08 * eB;
          // Where the lids meet (a blink, the joy crescent's lower edge) a soft lash crease: a closed eye, not a blank oval.
          float meet = mix(top, bot, 0.5), shut = 1.0 - smoothstep(-0.02, 0.22, top - bot);
          float lash = exp(-fk_sq((y - meet) / (0.045 + aa))) * shut * (1.0 - smoothstep(0.55, 0.95, abs(x)));
          float lowEdge = exp(-fk_sq((y - bot) / (0.05 + aa))) * uLid.w * (1.0 - shut) * (1.0 - smoothstep(0.5, 0.9, abs(x)));   // the cheek pushing up
          diffuseColor.rgb *= (1.0 - 0.55 * lash - 0.22 * lowEdge) * mix(1.0, 0.93, uLidCover);   // the lid sits in the socket's shade: never a pale patch
          if (vLidP.z < -0.25) fkLidA = 0.0;
          // Shut: the bead sinks under the skin and the shell's rim melts into the face (alpha-to-coverage shows the skin under it),
          // so a closed eye is a soft swell with a lash crease, never a raised oval with an outline.
          // Open or half-shut, only the outermost band melts (outside the bead's footprint, where there is skin under it).
          fkLidA *= mix(smoothstep(0.15, 0.36, vLidP.z), smoothstep(0.2, 0.62, vLidP.z), uLidShut);
          // The body's eye-socket shade, continued across the lid (same falloff), so a closed lid has no lighter rim.
          // Measured exactly as the body measures it (head space, across the face only), so lid and skin shade as one surface.
          vec2 sq = (vHeadP.xy - uEyeO.xy) / vec2(0.125, 0.23);
          fkLidAO = 1.0 - 0.35 * (1.0 - 0.6 * uLidCover) * exp(-dot(sq, sq) * 1.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, uShadowCol, (1.0 - fkLidAO) * 0.6);
        }`)
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= fkLidAO;\nreflectedLight.indirectSpecular *= mix(1.0, fkLidAO, 0.7);')
        .replace('#include <opaque_fragment>', /* glsl */`
        { float fres; outgoingLight += fk_skinAdd(normal, normalize(vViewPosition), 1.19, fkLidAO, fres);
          { float NdV2 = saturate(dot(normal, normalize(vViewPosition)));   // the body's soft knee, so a lid never reads lighter than the skin round it
            float lim = mix(1.7, 1.02, smoothstep(0.15, 0.6, NdV2)), kn = lim * 0.72;
            float pk = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
            if (pk > kn) outgoingLight *= (kn + (pk - kn) / (1.0 + (pk - kn) / (lim - kn))) / pk; }
          outgoingLight = fk_hue(outgoingLight, uHue);
          // Ghost mode: the lids take the same cool, desaturated, see-through grade as the body around them.
          float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          outgoingLight = mix(outgoingLight, mix(vec3(lum), uGhostCol * lum * 1.2, 0.65), uGhost * 0.6);
          outgoingLight = mix(outgoingLight, outgoingLight * 0.75 + uGhostCol * 0.12, uGhost);
          diffuseColor.a = fkLidA * mix(1.0, 0.88, uGhost); }   // nearly solid: a see-through lid over the black bead read as a grey glass dome
        #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'fk-lid-1';
    m.userData.u = own;
    return m;
  }

  /* Eye bead: glossy black, with a near-black layered iris that only shows up close and under a catch-light. */
  function makeBeadMat(outer: number) {
    const own = {
      uGaze: { value: new THREE.Vector2() }, uPupil: { value: 0.42 }, uLid: { value: new THREE.Vector4(0.08, 0, 0, 0) }, uOuter: { value: outer },
      uIris0: { value: C(COL.iris0) }, uIris1: { value: C(COL.iris1) }, uRimRefl: { value: C(COL.rimRefl) },
    };
    const m = new THREE.MeshPhysicalMaterial({
      color: COL.bead, roughness: 0.22, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.12, envMapIntensity: 0.12, specularIntensity: 0.3,   // the warm floor bounce must not read as a brown iris
    });
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, { uGlow: U.uGlow }, own);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vEyeP; varying vec3 vEyeV;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvEyeP = position;\nvEyeV = normalize(inverse(mat3(modelViewMatrix)) * (-mvPosition.xyz));');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_NOISE + /* glsl */`
        uniform vec2 uGaze; uniform float uPupil, uOuter, uGlow; uniform vec4 uLid; uniform vec3 uIris0, uIris1, uRimRefl;
        varying vec3 vEyeP; varying vec3 vEyeV;`)
        .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        float fkTop = fk_lidTop(vEyeP.x, uLid, uOuter), fkBot = fk_lidBot(vEyeP.x, uLid), fkPup;
        {
          vec3 g = normalize(vec3(uGaze * 0.35, 1.0));
          vec3 pv = normalize(normalize(vEyeP) - vEyeV * 0.10);             // the iris sits behind the cornea: parallax
          float ir = acos(clamp(dot(pv, g), -1.0, 1.0)) / 0.46;            // 0 centre .. 1 limbus
          vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), g)), ay = cross(g, ax);
          float phi = atan(dot(pv, ay), dot(pv, ax));
          float fib = fk_vnoise(vec3(phi * 10.19, ir * 7.0, 3.1)) * 0.6 + fk_vnoise(vec3(phi * 20.37, ir * 15.0, 7.7)) * 0.4;   // ~64 radial fibres
          vec3 irisC = mix(uIris0, uIris1, fib * (1.0 - smoothstep(0.3, 1.0, ir)));
          irisC *= 1.0 + 0.08 * exp(-fk_sq((ir - 0.45) / 0.05));          // collarette
          irisC *= 1.0 - 0.6 * smoothstep(0.88, 1.0, ir);                   // limbal ring
          irisC *= 0.1;                                                      // a glossy black bead first (the art has no iris): it only whispers up close
          fkPup = 1.0 - smoothstep(uPupil - 0.03, uPupil + 0.01, ir);
          diffuseColor.rgb = mix(mix(diffuseColor.rgb, irisC, 1.0 - smoothstep(0.98, 1.04, ir)), vec3(0.0), fkPup);
        }`)
        .replace('#include <opaque_fragment>', /* glsl */`
        {
          { float l = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));             // cool grey gloss: a warm env bounce must never read as a brown iris
            outgoingLight = mix(outgoingLight, vec3(l) * vec3(0.92, 0.96, 1.0), 0.8); }
          outgoingLight *= 1.0 - 0.72 * exp(-max(fkTop - vEyeP.y, 0.0) / 0.16);   // soft shadow from the upper lid
          outgoingLight += vec3(0.0015, 0.006, 0.004) * fkPup * uGlow;             // a barely-there deep green in the pupil, up close only
          float band = exp(-fk_sq((vEyeP.y + 0.78) / 0.09)) * smoothstep(0.1, 0.5, vEyeP.z) * (1.0 - smoothstep(0.4, 0.85, abs(vEyeP.x)));
          outgoingLight += uRimRefl * band * 0.32;                                  // lower rim reflection, as in the art
          outgoingLight *= 1.0 - 0.45 * smoothstep(0.45, 0.95, vEyeP.y) * smoothstep(0.2, 0.7, vEyeP.z);   // the brow's soft shadow across the top of the bead
          float wet = exp(-fk_sq((vEyeP.z - 0.46) / 0.07)) * smoothstep(-0.9, 0.2, vEyeP.y);
          outgoingLight += vec3(0.55, 0.68, 0.64) * wet * 0.09;                     // a faint moist meniscus where the bead meets the skin
          float tear = exp(-fk_sq((vEyeP.y - fkBot - 0.04) / 0.012)) * step(0.0, vEyeP.z);
          outgoingLight += vec3(0.85, 1.0, 0.92) * tear * 0.35;                    // wet line above the lower lid
        }
        #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'fk-bead-1';
    m.userData.u = own;
    return m;
  }

  /* Cornea: black + additive, so only its sharp wet reflection lands on top of the softer bead gloss. */
  const corneaMat = new THREE.MeshPhysicalMaterial({
    color: 0x000000, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, ior: 1.376, envMapIntensity: 0.3,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  // The wet reflection reads as cool grey glass, as in the art; untinted it mirrored the warm floor bounce and read as a brown iris.
  // Kept faint: a strong wet layer greyed the whole bead (worse under bloom), and the art's beads are black but for one highlight.
  corneaMat.onBeforeCompile = (s) => {
    s.uniforms.uGhost = U.uGhost;
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGhost;').replace('#include <opaque_fragment>', /* glsl */`
    { float l = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
      outgoingLight = mix(outgoingLight, vec3(l) * vec3(0.93, 0.96, 1.0), 0.85) * 0.45 * (1.0 - 0.5 * uGhost); }
    #include <opaque_fragment>`);
  };
  corneaMat.customProgramCacheKey = () => 'fk-cornea-1';

  return { injectCommon, bodyMat, bodyPreMat, bodyDepthMat, BEAD_LID, makeLidMat, makeBeadMat, corneaMat };
}
