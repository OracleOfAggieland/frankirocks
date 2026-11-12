/**
 * The bitemporal rule of spec §4 (design 6.6), one pure function for the route and for extraction. T or M words
 * are only alleged; a known end at or before now is history; a known start after now is scheduled; otherwise the
 * value is current. A history or scheduled placement never touches the current row (P6).
 */
import type { Class } from "../schema/primitives";
import type { Ms, Placement, PlacementChange } from "./types";

export function place(incoming: { from: Ms | null; to: Ms | null; cls: Class; change: PlacementChange }, now: Ms): Placement {
  if (incoming.cls === "T" || incoming.cls === "M") return "alleged";
  if (incoming.to !== null && incoming.to <= now) return "history";
  if (incoming.from !== null && incoming.from > now) return "scheduled";
  return "current";
}

/**
 * True when writing the placement closes what it replaces: a current value moves the old current value to history
 * (with `validTo = incoming.from ?? now`), and a correction moves its own targets to `wrong` through `statusTransition`.
 */
export function closesCurrent(p: Placement, change: PlacementChange): boolean {
  if (change === "correct") return true;
  return p === "current";
}
