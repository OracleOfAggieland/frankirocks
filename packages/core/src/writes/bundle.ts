/**
 * The bundle's state (design 6.7): the only code that decides `core/bundle.state`. A compiled Head is `clean`; a
 * failed compile or a burned bundle is `dirty` (the old Head stays, and writes still commit, G16); `blocked` stays
 * `blocked`, since only forget (F4) leaves it.
 */
import type { CoreBundle } from "../schema/records";

export type BundleState = CoreBundle["state"];
export type BundleEvent = "compiled" | "compileFailed" | "burned";

export function bundleAfter(prev: BundleState, e: BundleEvent): BundleState {
  if (prev === "blocked") return "blocked";
  return e === "compiled" ? "clean" : "dirty";
}
