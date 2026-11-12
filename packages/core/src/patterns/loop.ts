/**
 * The hero loop (spec §10 "Loop", §7 `celebrate`, contracts `Loop`, Money `LoopResult`, KJ03; design note 022 §3).
 * Pure. "Yes" plans the loop; three weeks on, `loopPredicate` compares equal windows from rows; `celebration` gives
 * the words for a closed loop with a good outcome, and a miss stays silent. Everything is `associationOnly`.
 */
import type { Cov } from "../schema/primitives";
import { tsFromMs } from "../schema/primitives";
import type { LoopRecord, LoopWindow } from "../schema/records";
import { addDays, datesFrom, dayStart, localAt, weekdayCounts } from "./civil";
import { coversDate, spendRows } from "./spend";
import type { BankObs, BankRow, LoopResult, LoopStatus, PatternResult } from "./types";
import { comparisonLines } from "./words";

/** A loop whose coverage was missing gets this many more reviews, then stays incomplete and silent. */
export const INCOMPLETE_REVIEWS = 1;

export const METRIC_CATEGORIES: Record<"takeoutSpend" | "totalFoodSpend", readonly BankObs["category"][]> = {
  takeoutSpend: ["takeout"],
  totalFoodSpend: ["takeout", "groceries", "restaurant"],
};

/**
 * The loop "yes" writes (contracts `Loop`). Baseline: the pattern's window. Comparison: as many dates, starting
 * the day after the accepted action's local date. `checkAt`: local midnight after the comparison ends. Null when
 * the pattern can't carry an offer, or the zone skips that midnight.
 */
export function planHeroLoop(p: PatternResult, acceptedAtMs: number, acceptedActionId: string): LoopRecord | null {
  if (p.status !== "eligible" || !p.mostly) return null;
  const w = p.window;
  const baseDates = datesFrom(w.fromCivil, w.toCivil);
  if (baseDates.length === 0) return null;
  const from = addDays(localAt(acceptedAtMs, w.zone).date, 1);
  const to = addDays(from, baseDates.length - 1);
  const check = dayStart(addDays(to, 1), w.zone);
  if (check === null) return null;
  const comparison: LoopWindow = { ...w, fromCivil: from, toCivil: to, purchaseIds: [], valueCents: null, weekdayCounts: weekdayCounts(datesFrom(from, to)) };
  return {
    acceptedActionId,
    metric: "takeoutSpend",
    baseline: { ...w, weekdayCounts: weekdayCounts(baseDates) },
    comparison,
    checkAt: tsFromMs(check),
    predicateVersion: "takeout_late_meeting_v1",
    state: "waiting",
    appraisalRef: null,
  };
}

export interface LoopInput {
  loop: LoopRecord;
  /** Bank rows around both windows (receipts aren't needed: the loop counts dates, and receipts never add). */
  purchases: readonly BankRow[];
  bankCoverage: Cov;
  worldNow: number;
  /** Compare another metric on the same windows (total food beside takeout); defaults to the loop's own. */
  metric?: "takeoutSpend" | "totalFoodSpend";
}

const sameArray = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function loopPredicate(input: LoopInput): LoopResult {
  const { loop } = input;
  const metric = input.metric ?? (loop.metric === "userAppraisal" ? null : loop.metric);
  const b = loop.baseline;
  const c = loop.comparison;
  const bDates = datesFrom(b.fromCivil, b.toCivil);
  const cDates = datesFrom(c.fromCivil, c.toCivil);
  const silent = (status: LoopStatus, why: LoopResult["why"]): LoopResult => ({
    associationOnly: true,
    status,
    metric: metric ?? loop.metric,
    beforeCents: null,
    afterCents: null,
    deltaCents: null,
    claim: "none",
    beforeIds: [],
    afterIds: [],
    rootKeys: [],
    why,
    windowDates: bDates.length,
  });
  if (loop.state === "cancelled") return silent("cancelled", "cancelled");
  // A user appraisal is not a money change, and its predicate isn't built here.
  if (metric === null) return silent("incomplete", null);
  if (input.worldNow < Date.parse(loop.checkAt)) return silent("waiting", "beforeCheckAt");
  if (bDates.length === 0 || bDates.length !== cDates.length) return silent("incomplete", "lengthDiffers");
  if (!sameArray(weekdayCounts(bDates), weekdayCounts(cDates))) return silent("incomplete", "weekdayMix");
  if (b.currency !== c.currency || b.zone !== c.zone) return silent("incomplete", "currency");
  const covered = (d: string) => coversDate(input.bankCoverage, d, b.zone);
  if (![...bDates, ...cDates].every(covered)) return silent("incomplete", "uncovered");

  const categories = METRIC_CATEGORIES[metric];
  const ask = (dates: string[]) => spendRows(input.purchases, { dates, zone: b.zone, currency: b.currency, categories, covered });
  const before = ask(bDates);
  const after = ask(cDates);
  if (before.partial || after.partial) return silent("incomplete", "rowsExcluded");
  const sum = (s: typeof before) => s.orders.reduce((a, o) => a + o.cents, 0);
  const ids = (s: typeof before) => s.orders.flatMap((o) => [o.id, ...o.refunds.map((r) => r.id)]);
  const keys = (s: typeof before) => s.orders.flatMap((o) => [o.rootKey, ...o.refunds.map((r) => r.rootKey)]);
  const beforeCents = sum(before);
  const afterCents = sum(after);
  if (metric === loop.metric && beforeCents !== b.valueCents) return silent("incomplete", "baselineMoved");

  const fell = afterCents < beforeCents;
  return {
    associationOnly: true,
    status: fell ? "eligible" : "noChange",
    metric,
    beforeCents,
    afterCents,
    deltaCents: beforeCents - afterCents,
    claim: fell ? (metric === "takeoutSpend" ? "categoryLess" : "netReductionScoped") : "none",
    beforeIds: ids(before),
    afterIds: ids(after),
    rootKeys: [...new Set([...keys(before), ...keys(after)])].slice(0, 128),
    why: fell ? null : "notImproved",
    windowDates: bDates.length,
  };
}

/**
 * The loop's next state from its state and a predicate result (a table). `celebrated`, `noChange` and `cancelled`
 * are terminal. `eligible` moves to `celebrated` only through `markCelebrated`, after its line has played.
 * `incomplete` gets INCOMPLETE_REVIEWS more reviews, counted by the caller.
 */
export function loopStateAfter(state: LoopRecord["state"], result: LoopStatus): LoopRecord["state"] {
  switch (state) {
    case "celebrated":
    case "noChange":
    case "cancelled":
      return state;
    case "waiting":
    case "incomplete":
    case "eligible":
      return result === "waiting" ? state : result;
    default:
      state satisfies never;
      return state;
  }
}

export const markCelebrated = (state: LoopRecord["state"]): LoopRecord["state"] => (state === "eligible" ? "celebrated" : state);

export interface Celebration {
  kind: "celebrate";
  lines: string[];
  rootKeys: string[];
}

/**
 * `celebrate` (spec §7): a closed loop with a good outcome gives the comparison words; anything else, a miss
 * included, gives null and stays silent. A total-food result on the same windows may add its scoped line.
 */
export function celebration(loop: LoopRecord, result: LoopResult, totalFood: LoopResult | null = null): Celebration | null {
  if (loop.state === "celebrated" || loop.state === "cancelled" || loop.state === "noChange") return null;
  const lines = comparisonLines(result);
  if (lines === null) return null;
  const scoped = totalFood === null ? null : comparisonLines(totalFood);
  return { kind: "celebrate", lines: [...lines, ...(scoped ?? [])], rootKeys: [...new Set([...result.rootKeys, ...(scoped === null ? [] : totalFood!.rootKeys)])] };
}
