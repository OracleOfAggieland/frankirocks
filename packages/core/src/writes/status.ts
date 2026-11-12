/**
 * Memory status transitions (design 6.5): the only code that decides a Memory's next status when a correction or a
 * change names it. A correction marks the old value `wrong`, never history (spec §4); a change moves a current value
 * to `history`; a `wrong`, `retracted` or `blocked` row refuses every later event, so an error never comes back.
 */
import type { MemoryStatus, StatusEvent } from "./types";

const TABLE: Record<MemoryStatus, Record<StatusEvent, MemoryStatus | "refuse">> = {
  active: { correct: "wrong", transition: "history" },
  // F6 owns a scheduled row's start; a change can't move it here.
  scheduled: { correct: "wrong", transition: "refuse" },
  history: { correct: "wrong", transition: "history" },
  alleged: { correct: "wrong", transition: "refuse" },
  wrong: { correct: "refuse", transition: "refuse" },
  retracted: { correct: "refuse", transition: "refuse" },
  blocked: { correct: "refuse", transition: "refuse" },
};

export function statusTransition(from: MemoryStatus, e: StatusEvent): MemoryStatus | "refuse" {
  return TABLE[from]?.[e] ?? "refuse";
}
