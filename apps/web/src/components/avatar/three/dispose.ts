// Frees one engine (new code, ported in WP10; map A §13). Each part is freed only if present, so a build that
// failed half-way is freed by the same function. Frees every geometry, material and texture reachable from the
// scene (customDepthMaterial and uniform textures included), the environment texture, brushTex, both passes, the
// shadow map and the renderer; then forceContextLoss, which is never skipped: r187's renderer.dispose() does not free
// its own output targets or the PMREM target. Removes the canvas. Idempotent.
import type { Rig } from "./context";
import { notPorted } from "./errors";

export function disposeRig(rig: Partial<Rig>): void {
  notPorted("disposeRig", rig);
}
