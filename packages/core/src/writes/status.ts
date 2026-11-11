/**
 * Memory status transitions (design 6.5): the only code that decides a Memory's next status.
 * Stub from wave A task A2; task A6 builds it.
 */
import type { MemoryStatus, StatusEvent } from "./types";
import { NotBuilt } from "./types";

export function statusTransition(_from: MemoryStatus, _e: StatusEvent): MemoryStatus | "refuse" {
  throw new NotBuilt("statusTransition");
}
