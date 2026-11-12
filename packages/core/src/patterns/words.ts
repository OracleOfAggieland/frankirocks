/**
 * The spoken templates for the hero (spec §10, contracts Money; design note 022 §2). Code fills every number from
 * a detector or predicate result; a model never writes one. Patterns are associations, never causes: no line holds
 * a word from `CAUSAL_WORDS`, and `hasCausalWord` is how a caller checks any line before it is said.
 *
 * No spoken template table exists on the server, and `apps/web/src/ui/copy.ts` holds screen copy, so the spoken
 * lines live here beside the numbers they need.
 */
import type { LoopResult, PatternResult } from "./types";

export const CAUSAL_WORDS = ["because", "caused", "cause", "causes", "thanks to", "won back", "led to", "due to", "so you saved"] as const;

const CAUSAL = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${CAUSAL_WORDS.map((w) => w.replace(/ /g, "\\s+")).join("|")})(?![\\p{L}\\p{N}_])`, "iu");

export const hasCausalWord = (text: string): boolean => CAUSAL.test(text);

/** "$186", "$186.50", "$1,186". Amounts are absolute; a line says "down from" or "less" for direction. */
export function formatDollars(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = abs % 100;
  return rest === 0 ? `$${dollars}` : `$${dollars}.${String(rest).padStart(2, "0")}`;
}

const WEEK_WORDS = ["", "week", "two weeks", "three weeks", "four weeks", "five weeks", "six weeks"];

/** "three weeks" for 21 dates, "10 days" otherwise. */
export function spanWords(days: number): string {
  if (days > 0 && days % 7 === 0) return WEEK_WORDS[days / 7] ?? `${days / 7} weeks`;
  return days === 1 ? "day" : `${days} days`;
}

function guard(line: string): string | null {
  return hasCausalWord(line) ? null : line;
}

/** The offer, only for an eligible pattern that is mostly on late-meeting dates. */
export function heroOfferLine(p: PatternResult): string | null {
  if (p.status !== "eligible" || !p.mostly || p.totalCents <= 0) return null;
  const unit = p.associationUnit === "night" ? "nights" : "days";
  return guard(
    `You've spent ${formatDollars(p.totalCents)} on takeout in this window, mostly on ${unit} with meetings after 6. Sources are on the card. Want three quick dinners for those ${unit}, with groceries on your list?`,
  );
}

/** "$115 less on takeout": the fall alone, for the strip's last step (brief 030 P1-4). Null for no fall. */
export function lessOnTakeoutLine(deltaCents: number): string | null {
  if (!Number.isSafeInteger(deltaCents) || deltaCents <= 0) return null;
  return guard(`${formatDollars(deltaCents)} less on takeout.`);
}

/**
 * The lines of the offer's source card, worded by code from the same numbers as the offer. Every line passes the
 * guard, or the card has no lines (null) and the offer isn't made.
 */
export function heroOfferCardLines(p: PatternResult): string[] | null {
  if (heroOfferLine(p) === null) return null;
  const unit = p.associationUnit === "night" ? "nights" : "days";
  const lines = [
    `${formatDollars(p.totalCents)} on takeout, ${p.orderCount} orders, ${p.window.fromCivil} to ${p.window.toCivil}`,
    `${formatDollars(p.lateCents)} of it in ${p.lateOrderCount} orders on ${unit} with meetings after 6`,
    // Brief 037, finding 10: the old line, "A pattern in your own records, not a cause", held a causal word.
    "Seen together in your own records, and nothing more",
  ];
  const checked = lines.map(guard);
  return checked.every((x): x is string => x !== null) ? checked : null;
}

/**
 * The comparison, only for an eligible result with a fall: "Takeout's $71, down from $186 over the same three
 * weeks." and "$115 less on takeout." A scoped total-food result gives its own one line.
 */
export function comparisonLines(r: LoopResult): string[] | null {
  if (r.status !== "eligible" || r.beforeCents === null || r.afterCents === null || r.deltaCents === null) return null;
  if (r.deltaCents <= 0 || r.afterCents < 0 || r.deltaCents !== r.beforeCents - r.afterCents) return null;
  const span = spanWords(r.windowDates);
  let out: string[] | null = null;
  if (r.metric === "takeoutSpend" && r.claim === "categoryLess") {
    out = [`Takeout's ${formatDollars(r.afterCents)}, down from ${formatDollars(r.beforeCents)} over the same ${span}.`, lessOnTakeoutLine(r.deltaCents)!];
  } else if (r.metric === "totalFoodSpend" && r.claim === "netReductionScoped") {
    out = [`All food spending was ${formatDollars(r.afterCents)}, down from ${formatDollars(r.beforeCents)} over the same ${span}.`];
  }
  if (out === null) return null;
  const checked = out.map(guard);
  return checked.every((x): x is string => x !== null) ? checked : null;
}
