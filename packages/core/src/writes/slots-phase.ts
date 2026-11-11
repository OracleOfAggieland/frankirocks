/**
 * The FastSlots call per request (design 6.1): the only code that decides when the call starts and settles.
 *
 * From `idle`, `ready` (beginRequest returned new and the context is read) and `parsed` update what is known; once
 * the context is read, a regex match, an asked question or a route candidate starts the call (in that order of
 * precedence) with its deadline counted from that event; with the context read, a parse that found nothing, no
 * regex and nothing asked, the call isn't needed. A running call settles on its answer or on a due deadline, and a
 * settled or unneeded call never changes. A replayed request never reaches `ready`, so it never calls FastSlots.
 */
import type { SlotsEvent, SlotsPhase, SlotsTrigger } from "./types";

/** contracts §5, assumed; measured in wave A; counted from the call's start. */
export const FAST_SLOTS_DEADLINE_MS = 900;

/** `regex`: the final transcript matched RX4, RX6 or RX7. */
export function initialSlots(regex: boolean): SlotsPhase {
  return { kind: "idle", regex, ctx: false, asked: false, parse: "pending" };
}

export function nextSlots(p: SlotsPhase, e: SlotsEvent): { phase: SlotsPhase; start: boolean } {
  const stay = { phase: p, start: false };
  switch (p.kind) {
    case "settled":
    case "notNeeded":
      return stay;
    case "running":
      if (e.kind === "answered") return { phase: { kind: "settled", result: e.result }, start: false };
      if (e.kind === "deadline" && e.at >= p.deadlineAt) return { phase: { kind: "settled", result: { kind: "timeout", ms: FAST_SLOTS_DEADLINE_MS } }, start: false };
      return stay;
    case "idle": {
      if (e.kind !== "ready" && e.kind !== "parsed") return stay;
      const idle =
        e.kind === "ready"
          ? { ...p, ctx: true, asked: p.asked || e.asked }
          : { ...p, parse: e.route ? ("route" as const) : p.parse === "route" ? ("route" as const) : ("none" as const) };
      if (!idle.ctx) return { phase: idle, start: false };
      const trigger: SlotsTrigger | null = idle.regex ? "regex" : idle.asked ? "asked" : idle.parse === "route" ? "candidate" : null;
      if (trigger !== null) return { phase: { kind: "running", trigger, deadlineAt: e.at + FAST_SLOTS_DEADLINE_MS }, start: true };
      if (idle.parse === "none") return { phase: { kind: "notNeeded" }, start: false };
      return { phase: idle, start: false };
    }
  }
}
