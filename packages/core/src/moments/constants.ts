/**
 * One-shot time (brief 023; spec §5 Floor rows; design note 023). Every threshold the moments code reads is one named
 * constant here, so a ruling is a one-line change.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Wish: the later of 08:00 and the earlier of 08:30 and start minus 3 hours (spec §5 Occasion). */
export const WISH_EARLIEST_MINUTE = 8 * 60;
export const WISH_LATEST_MINUTE = 8 * 60 + 30;
export const WISH_LEAD_MS = 3 * HOUR_MS;

/** Check-in: end plus 3 hours, or 18:00 for a day-only date (spec §5 Occasion). */
export const CHECKIN_AFTER_END_MS = 3 * HOUR_MS;
export const CHECKIN_DAY_MINUTE = 18 * 60;

/** An instant occasion with no end ends this long after it starts (design note 023 gap 4). */
export const OCCASION_DEFAULT_MINUTES = 60;

/** closeAt (contracts "derive by kind"): checkIn and ask at end + 3 d, celebrate at checkAt + 7 d, others due + 30 d. */
export const OUTCOME_CLOSE_DAYS = 3;
export const CELEBRATE_CLOSE_DAYS = 7;
export const OTHER_CLOSE_DAYS = 30;

/** A pattern's insight: once its detector passes, 30-day cooldown (spec §5 Pattern). */
export const INSIGHT_COOLDOWN_DAYS = 30;

/** How long an opened moment stays leased for delivery before it returns to pending (design note 023 gap 7). */
export const OPEN_LEASE_MS = 15 * MINUTE_MS;

/** A reminder for a day without a clock time is due at 09:00 local (design note 023 gap 13). */
export const REMINDER_DAY_MINUTE = 9 * 60;

/** Delivery (spec §5 Delivery). Quiet hours are [21:30, 08:00) local. */
export { QUIET_START_MINUTE as QUIET_FROM_MINUTE } from "../gate/quiet-hours";
export { QUIET_END_MINUTE as QUIET_TO_MINUTE } from "../gate/quiet-hours";
export const PROACTIVE_DAY_CAP = 3;
export const HEAVY_DAY_CAP = 1;
/** "Listening and silent for 8 s". */
export const IDLE_SILENCE_MS = 8_000;
/** No insight, celebrate or ask within two turns of a check-in answer. */
export const CHECKIN_GAP_TURNS = 2;
/** A moment whose source has at least this gravity is heavy (design note 023 §5). One definition, the Gate's. */
export { HEAVY_GRAVITY } from "../gate/gate";
/** Cards a Proactive may carry (wire `Proactive.cards`). */
export const DELIVERY_CARD_MAX = 2;
