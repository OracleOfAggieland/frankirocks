/**
 * The bitemporal rule of spec §4 (design 6.6), one pure function for the route and for extraction.
 * Stub from wave A task A2; task A6 builds it.
 */
import type { Class } from "../schema/primitives";
import type { Ms, Placement, PlacementChange } from "./types";
import { NotBuilt } from "./types";

export function place(_incoming: { from: Ms | null; to: Ms | null; cls: Class; change: PlacementChange }, _now: Ms): Placement {
  throw new NotBuilt("place");
}

export function closesCurrent(_p: Placement, _change: PlacementChange): boolean {
  throw new NotBuilt("closesCurrent");
}
