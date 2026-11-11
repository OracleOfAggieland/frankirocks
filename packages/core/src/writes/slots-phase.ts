/**
 * The FastSlots call per request (design 6.1): the only code that decides when the call starts and settles.
 * Stub from wave A task A2; task A8 builds it.
 */
import type { SlotsEvent, SlotsPhase } from "./types";
import { NotBuilt } from "./types";

/** contracts §5, assumed; measured in wave A; counted from the call's start. */
export const FAST_SLOTS_DEADLINE_MS = 900;

/** `regex`: the final transcript matched RX4, RX6 or RX7. */
export function initialSlots(_regex: boolean): SlotsPhase {
  throw new NotBuilt("initialSlots");
}

export function nextSlots(_p: SlotsPhase, _e: SlotsEvent): { phase: SlotsPhase; start: boolean } {
  throw new NotBuilt("nextSlots");
}
