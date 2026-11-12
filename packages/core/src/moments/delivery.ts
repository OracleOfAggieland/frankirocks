/**
 * Delivery (brief 023 task 6; spec §5 Delivery, §6 Floors; design note 023 §5). Pure: the open moments, the session's
 * state and today's counts in; one spoken choice, up to two cards and a reason code for every candidate out. Putting
 * the choice on the wire as a `Proactive` is the server's (`time/proactive.ts`).
 */
import { inQuietHours } from "../gate/quiet-hours";
import type { CoreCounters, MomentKind } from "../schema/records";
import {
  CHECKIN_GAP_TURNS,
  DELIVERY_CARD_MAX,
  HEAVY_DAY_CAP,
  HEAVY_GRAVITY,
  IDLE_SILENCE_MS,
  PROACTIVE_DAY_CAP,
} from "./constants";

export interface DeliveryCandidate {
  momentId: string;
  kind: MomentKind;
  dueAt: number;
  heavy: boolean;
  mustSay: boolean;
  /** A code-verified `deliveryOverride`: each flag passes only the limit it names. */
  override: { quietHours: boolean; caps: boolean } | null;
}

/** An open session (whisper at the next idle moment) or a session opening (its first line). */
export type DeliveryMode = { kind: "session"; listening: boolean; silentMs: number } | { kind: "opening" };

export interface DeliveryInput {
  candidates: readonly DeliveryCandidate[];
  mode: DeliveryMode;
  /** The session holds a transition or crisis candidate. */
  transitionOrCrisis: boolean;
  /** Turns since the owner answered a check-in in this session; null when none was answered. */
  turnsSinceCheckInAnswer: number | null;
  /** Proactive lines and heavy ones already spoken this world day (`countDelivery`). */
  today: { proactive: number; heavy: number };
  worldNow: number;
  zone: string;
}

export type DeliveryReason =
  | "chosen"
  | "card"
  | "quietHours"
  | "dayCap"
  | "heavyCap"
  | "transitionHold"
  | "afterCheckIn"
  | "notIdle"
  | "lowerRank"
  | "cardLimit";

export interface DeliveryChoice {
  spoken: { momentId: string; channel: "whisper" | "opening" } | null;
  cards: string[];
  reasons: { momentId: string; code: DeliveryReason }[];
}

/** Opening-line priority (spec §5): mustSay, wish, check-in, ask, insight, celebrate, others. */
const RANK: Partial<Record<MomentKind, number>> = { wish: 1, checkIn: 2, ask: 3, expiryAsk: 3, insight: 4, celebrate: 5 };
const rankOf = (c: DeliveryCandidate): number => (c.mustSay ? 0 : (RANK[c.kind] ?? 6));
/** No insight, celebrate or ask with a transition or crisis candidate, or within two turns of a check-in answer. */
const HELD_AFTER_CHECKIN: readonly MomentKind[] = ["insight", "celebrate", "ask", "expiryAsk"];
const HEAVY_KINDS: readonly MomentKind[] = ["griefAsk", "transition", "door"];

/** Heavy (design note 023 §5): the source's gravity is 2 or more, or the kind is heavy by nature. */
export const isHeavy = (kind: MomentKind, gravity: number): boolean => gravity >= HEAVY_GRAVITY || HEAVY_KINDS.includes(kind);
/** No floor kind is mustSay; the flag is an input for later kinds (hard-rule conflicts, commitments due in 24 h). */
export const isMustSay = (_kind: MomentKind): boolean => false;

/** Quiet hours have one definition, the Gate's: an unknown zone counts as quiet. */
export { inQuietHours };

/** Why a candidate may not be spoken now, or null when it may. */
function speechLimit(c: DeliveryCandidate, input: DeliveryInput): DeliveryReason | null {
  if (c.mustSay) return null;
  if (!(c.override?.quietHours ?? false) && inQuietHours(input.worldNow, input.zone)) return "quietHours";
  if (!(c.override?.caps ?? false)) {
    if (input.today.proactive >= PROACTIVE_DAY_CAP) return "dayCap";
    if (c.heavy && input.today.heavy >= HEAVY_DAY_CAP) return "heavyCap";
  }
  return null;
}

export function chooseDelivery(input: DeliveryInput): DeliveryChoice {
  const reasons: DeliveryChoice["reasons"] = [];
  const recentCheckIn = input.turnsSinceCheckInAnswer !== null && input.turnsSinceCheckInAnswer < CHECKIN_GAP_TURNS;
  const open: DeliveryCandidate[] = [];
  for (const c of input.candidates) {
    if (HELD_AFTER_CHECKIN.includes(c.kind) && !c.mustSay) {
      if (input.transitionOrCrisis) {
        reasons.push({ momentId: c.momentId, code: "transitionHold" });
        continue;
      }
      if (recentCheckIn) {
        reasons.push({ momentId: c.momentId, code: "afterCheckIn" });
        continue;
      }
    }
    open.push(c);
  }
  open.sort((a, b) => rankOf(a) - rankOf(b) || a.dueAt - b.dueAt || (a.momentId < b.momentId ? -1 : a.momentId > b.momentId ? 1 : 0));

  if (input.mode.kind === "session") {
    const idle = input.mode.listening && input.mode.silentMs >= IDLE_SILENCE_MS;
    let spoken: DeliveryChoice["spoken"] = null;
    for (const c of open) {
      if (!idle) reasons.push({ momentId: c.momentId, code: "notIdle" });
      else if (spoken !== null) reasons.push({ momentId: c.momentId, code: "lowerRank" });
      else {
        const limit = speechLimit(c, input);
        if (limit !== null) reasons.push({ momentId: c.momentId, code: limit });
        else {
          spoken = { momentId: c.momentId, channel: "whisper" };
          reasons.push({ momentId: c.momentId, code: "chosen" });
        }
      }
    }
    return { spoken, cards: [], reasons };
  }

  // A session opening: the best speakable moment is its first line; the rest go to cards.
  let spoken: DeliveryChoice["spoken"] = null;
  const cards: string[] = [];
  for (const c of open) {
    const limit = spoken === null ? speechLimit(c, input) : "lowerRank";
    if (limit === null) {
      spoken = { momentId: c.momentId, channel: "opening" };
      reasons.push({ momentId: c.momentId, code: "chosen" });
    } else if (cards.length < DELIVERY_CARD_MAX) {
      cards.push(c.momentId);
      reasons.push({ momentId: c.momentId, code: limit === "lowerRank" ? "card" : limit });
    } else reasons.push({ momentId: c.momentId, code: "cardLimit" });
  }
  return { spoken, cards, reasons };
}

/**
 * Counts one admitted proactive line in `core/counters` (design note 023 gap 12): the `speech` count and `heavy`
 * reset when the world day changes. The receipt seam calls it in the admission's transaction.
 */
export function countDelivery(counters: CoreCounters, worldDay: string, heavy: boolean): CoreCounters {
  const fresh = counters.day !== worldDay;
  const counts = fresh ? [] : counters.counts.filter((c) => c.kind !== "speech");
  const speech = fresh ? 0 : (counters.counts.find((c) => c.kind === "speech")?.count ?? 0);
  return {
    ...counters,
    day: worldDay,
    heavy: (fresh ? 0 : counters.heavy) + (heavy ? 1 : 0),
    counts: [...counts, { kind: "speech" as const, count: speech + 1 }].slice(0, 8),
  };
}

/** Today's counts from `core/counters` for `chooseDelivery`. */
export function todayCounts(counters: CoreCounters, worldDay: string): { proactive: number; heavy: number } {
  if (counters.day !== worldDay) return { proactive: 0, heavy: 0 };
  return { proactive: counters.counts.find((c) => c.kind === "speech")?.count ?? 0, heavy: counters.heavy };
}
