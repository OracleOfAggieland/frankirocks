// Frees one engine (new code, ported in WP10; map A §13). Each part is freed only if present, so a build that
// failed half-way is freed by the same function. Frees every geometry, material and texture reachable from the
// scene (customDepthMaterial and uniform textures included), the environment texture, brushTex, both passes, the
// shadow map and the renderer; then forceContextLoss, which is never skipped: r187's renderer.dispose() does not free
// its own output targets or the PMREM target. Removes the canvas. Idempotent.
//
// GPU resources are freed while the renderer is still alive, because three frees a geometry's buffers, a
// material's programs and a texture's GL texture from their `dispose` events, which the renderer listens to.
// Objects a part holds outside the scene (a geometry not yet added, the tuft geometries the mop was merged from, a
// material made but never assigned) are found by one sweep over the rig's own fields. Listeners and the frame loop
// are not here: the loop's detach() and send('dispose') stop them first (engine.ts).
import type * as THREE from "three";
import type { Rig } from "./context";

/** Rigs already freed: a second call does nothing. */
const freed = new WeakSet<object>();

interface Disposable { dispose(): void }
type Flagged = { isBufferGeometry?: boolean; isMaterial?: boolean; isTexture?: boolean; isRenderTarget?: boolean };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Geometries, materials, textures and render targets, by three's own type flags. */
function isResource(v: unknown): v is Disposable & Flagged {
  if (!isObject(v)) return false;
  const f = v as Flagged;
  return (f.isBufferGeometry === true || f.isMaterial === true || f.isTexture === true || f.isRenderTarget === true)
    && typeof (v as Partial<Disposable>).dispose === "function";
}

export function disposeRig(rig: Partial<Rig>): void {
  if (freed.has(rig)) return;
  freed.add(rig);
  const done = new Set<unknown>();
  const free = (v: unknown) => {
    if (!isResource(v) || done.has(v)) return;
    done.add(v);
    v.dispose();
  };
  /** A material, every texture it holds, and every texture in its uniforms. */
  const freeMaterial = (m: unknown) => {
    if (!isResource(m) || done.has(m)) return;
    for (const value of Object.values(m)) if (isObject(value) && (value as Flagged).isTexture) free(value);
    const uniforms = (m as { uniforms?: unknown }).uniforms;
    if (isObject(uniforms)) freeUniforms(uniforms);
    free(m);
  };
  const freeUniforms = (bag: Record<string, unknown> | undefined) => {
    if (!bag) return;
    for (const u of Object.values(bag)) {
      if (!isObject(u)) continue;
      const value = (u as { value?: unknown }).value;
      if (Array.isArray(value)) value.forEach(free);
      else free(value);
    }
  };
  const freeAny = (v: unknown) => {
    if (!isResource(v)) return;
    if ((v as Flagged).isMaterial) freeMaterial(v);
    else free(v);
  };

  try {
    const { scene } = rig;
    if (scene) {
      scene.traverse((o: THREE.Object3D) => {
        const mesh = o as Partial<THREE.Mesh> & { customDepthMaterial?: THREE.Material; customDistanceMaterial?: THREE.Material };
        if (mesh.geometry) free(mesh.geometry);
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach(freeMaterial);
        else freeMaterial(mat);
        freeMaterial(mesh.customDepthMaterial);
        freeMaterial(mesh.customDistanceMaterial);
        const light = o as Partial<THREE.DirectionalLight>;
        if (light.isLight && light.shadow) light.shadow.dispose();
      });
      free(scene.environment);
      free(scene.background);
    }
    // The shared uniform bags (map A finding 2), then every resource a part holds directly or in an array or a
    // plain record one level down (eyes, bolts, the tufts).
    freeUniforms(rig.U as Record<string, unknown> | undefined);
    freeUniforms(rig.hairU as Record<string, unknown> | undefined);
    freeUniforms(rig.brassU as Record<string, unknown> | undefined);
    freeUniforms(rig.groundU as Record<string, unknown> | undefined);
    free(rig.brushTex);
    for (const value of Object.values(rig)) {
      if (isResource(value)) freeAny(value);
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (isResource(item)) freeAny(item);
          else if (isObject(item) && Object.getPrototypeOf(item) === Object.prototype) Object.values(item).forEach(freeAny);
        }
      }
    }
    if (rig.bloomPass) rig.bloomPass.dispose();
    if (rig.gradePass) rig.gradePass.dispose();
    if (rig.renderer) rig.renderer.dispose();
  } finally {
    try {
      if (rig.renderer) rig.renderer.forceContextLoss();
    } finally {
      if (rig.canvas) rig.canvas.remove();
    }
  }
}
