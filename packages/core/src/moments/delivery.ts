/**
 * Delivery (brief 023 task 6; spec §5 Delivery, §6 Floors; design note 023 §5). Pure: the open moments, the session's
 * state and today's counts in; one spoken choice, up to two cards and a reason code for every candidate out. Putting
 * the choice on the wire as a `Proactive` is the server's (`time/proactive.ts`).
 */
import { inQuietHours } from "../gate/quiet-hours";
import type { CoreCounters, MomentKind } from "../schema/records";
import {
  CHECKIN_GAP_TURNS,
  MUST_SAY_WITHIN_MS,
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

/**
 * The session's holds (brief 036 finding 4: crisis and transition are separate inputs). `transition`: the session
 * holds a transition candidate. `crisis`: it holds a crisis candidate. The older single flag still reads, failing
 * closed: it holds as both, since it can't say which it meant.
 */
export type SessionHolds = { transition: boolean; crisis: boolean } | { transitionOrCrisis: boolean };

export const holdsOf = (h: SessionHolds): { transition: boolean; crisis: boolean } =>
  "transitionOrCrisis" in h ? { transition: h.transitionOrCrisis, crisis: h.transitionOrCrisis } : { transition: h.transition, crisis: h.crisis };

export type DeliveryInput = SessionHolds & {
  candidates: readonly DeliveryCandidate[];
  mode: DeliveryMode;
  /** Turns since the owner answered a check-in in this session; null when none was answered. */
  turnsSinceCheckInAnswer: number | null;
  /** Proactive lines and heavy ones already spoken this world day (`countDelivery`). */
  today: { proactive: number; heavy: number };
  worldNow: number;
  zone: string;
};

export type DeliveryReason =
  | "chosen"
  | "card"
  | "quietHours"
  | "dayCap"
  | "heavyCap"
  | "transitionHold"
  | "crisisHold"
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
/**
 * No insight, celebrate or ask with a transition or crisis candidate, or within two turns of a check-in answer. A
 * grief ask is held the same way (brief 036 finding 4).
 */
const HELD_AFTER_CHECKIN: readonly MomentKind[] = ["insight", "celebrate", "ask", "expiryAsk", "griefAsk"];
const HEAVY_KINDS: readonly MomentKind[] = ["griefAsk", "transition", "door"];

/** Heavy (design note 023 §5): the source's gravity is 2 or more, or the kind is heavy by nature. */
export const isHeavy = (kind: MomentKind, gravity: number): boolean => gravity >= HEAVY_GRAVITY || HEAVY_KINDS.includes(kind);
/**
 * mustSay (spec �6 Floors; contracts line 332 "commitment due<=24h"). Brief 036 finding 8: a confirmed reminder
 * (`commitmentDue`, written only by the confirmed `makeReminder` executor) due within 24 hours of the world time is
 * mustSay. Nothing else in the floor is. A non-finite time is never mustSay.
 */
export const isMustSay = (kind: MomentKind, dueAt: number, worldNow: number): boolean =>
  kind === "commitmentDue" && Number.isFinite(dueAt) && Number.isFinite(worldNow) && dueAt - worldNow <= MUST_SAY_WITHIN_MS;

/** Quiet hours have one definition, the Gate's: an unknown zone counts as quiet. */
export { inQuietHours };

/**
 * The day's caps at admission (brief 036 finding 5): the reason a line may not be admitted with today's counts, or
 * null. A mustSay passes; a verified override passes the caps it names.
 */
export function capLimit(c: Pick<DeliveryCandidate, "heavy" | "mustSay" | "override">, today: { proactive: number; heavy: number }): "dayCap" | "heavyCap" | null {
  if (c.mustSay || (c.override?.caps ?? false)) return null;
  if (today.proactive >= PROACTIVE_DAY_CAP) return "dayCap";
  if (c.heavy && today.heavy >= HEAVY_DAY_CAP) return "heavyCap";
  return null;
}

/** Why a candidate may not be spoken now, or null when it may. */
function speechLimit(c: DeliveryCandidate, input: DeliveryInput): DeliveryReason | null {
  if (c.mustSay) return null;
  if (!(c.override?.quietHours ?? false) && inQuietHours(input.worldNow, input.zone)) return "quietHours";
  return capLimit(c, input.today);
}

export function chooseDelivery(input: DeliveryInput): DeliveryChoice {
  const reasons: DeliveryChoice["reasons"] = [];
  const recentCheckIn = input.turnsSinceCheckInAnswer !== null && input.turnsSinceCheckInAnswer < CHECKIN_GAP_TURNS;
  const { transition, crisis } = holdsOf(input);
  const open: DeliveryCandidate[] = [];
  for (const c of input.candidates) {
    if (c.mustSay) {
      open.push(c);
      continue;
    }
    if (HELD_AFTER_CHECKIN.includes(c.kind) && (transition || crisis)) {
      reasons.push({ momentId: c.momentId, code: "transitionHold" });
      continue;
    }
    // Crisis holds every candidate that is not mustSay: no wish or check-in after "He didn't make it".
    if (crisis) {
      reasons.push({ momentId: c.momentId, code: "crisisHold" });
      continue;
    }
    if (HELD_AFTER_CHECKIN.includes(c.kind)) {
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
  // A zone change can make "today" an earlier date than the stored one: count it into the stored day, so a day's
  // count is never reset to one it already had (brief 036 finding 5).
  const fresh = counters.day < worldDay;
  worldDay = fresh ? worldDay : counters.day;
  const counts = fresh ? [] : counters.counts.filter((c) => c.kind !== "speech");
  const speech = fresh ? 0 : (counters.counts.find((c) => c.kind === "speech")?.count ?? 0);
  return {
    ...counters,
    day: worldDay,
    heavy: (fresh ? 0 : counters.heavy) + (heavy ? 1 : 0),
    counts: [...counts, { kind: "speech" as const, count: speech + 1 }].slice(0, 8),
  };
}

/**
 * Today's counts from `core/counters` for `chooseDelivery` and `admitMoment`. A world day earlier than the stored one
 * (a zone change moved "today" back) reads as full: its count is not known (brief 036 finding 5).
 */
export function todayCounts(counters: CoreCounters, worldDay: string): { proactive: number; heavy: number } {
  if (counters.day > worldDay) return { proactive: PROACTIVE_DAY_CAP, heavy: HEAVY_DAY_CAP };
  if (counters.day !== worldDay) return { proactive: 0, heavy: 0 };
  return { proactive: counters.counts.find((c) => c.kind === "speech")?.count ?? 0, heavy: counters.heavy };
}
