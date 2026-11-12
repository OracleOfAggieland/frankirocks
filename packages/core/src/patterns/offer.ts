/**
 * The hero offer as a pending question (spec §10, contracts `answer`; design note 022 §5 and gap 6). No pending
 * collection exists yet, so the offer's identity is its content: the detector version, the window and every cited
 * row. A "yes" reruns the detector and must reproduce the same identity, or the offer is stale. Code, not the
 * model, decides that the owner's own words said yes.
 */
import { addDays } from "./civil";
import type { PatternResult, WindowAsk } from "./types";

/** The hero window: the 21 local dates ending the day before `today`. */
export function heroWindow(today: string, zone: string, currency: string): WindowAsk {
  const toCivil = addDays(today, -1);
  return { fromCivil: addDays(toCivil, -20), toCivil, zone, currency };
}

/** What the offer's ID is hashed from. Equal parts mean the same offer. */
export function heroOfferParts(p: PatternResult): unknown[] {
  const w = p.window;
  // Everything the offer's words and card say (brief 037, finding 9): a receipt that turns "days" into "nights", or a
  // change in the late count or in "mostly", makes a new offer, and the old one's yes is stale.
  return [
    "heroOffer",
    p.detectorVersion,
    w.fromCivil,
    w.toCivil,
    w.zone,
    w.currency,
    p.totalCents,
    p.lateCents,
    [...w.purchaseIds].sort(),
    [...p.meetingIds].sort(),
    [...p.receiptIds].sort(),
    [...p.latePurchaseIds].sort(),
    p.associationUnit,
    p.orderCount,
    p.lateOrderCount,
    p.mostly,
  ];
}

/**
 * The closed list of plain yeses (brief 037, finding 4): an affirmative, with at most one of PLAIN_YES_TAILS after
 * it, as the whole utterance. Anything else is not a yes, and Franki may ask again.
 */
export const PLAIN_YES_AFFIRMATIVES = ["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "absolutely", "definitely", "sounds good", "go ahead", "lets do it", "lets do that"] as const;
export const PLAIN_YES_TAILS = ["please", "thanks", "thank you", "lets do it"] as const;

const PLAIN_YES = new Set<string>(PLAIN_YES_AFFIRMATIVES.flatMap((a) => [a, ...PLAIN_YES_TAILS.map((t) => `${a} ${t}`)]));

/**
 * True when the owner's own words are, as a whole, one plain yes from the closed list. Case, punctuation and
 * apostrophes don't matter. "Yes.", "Yeah, let's do it" and "OK please" pass; "Sure, tell me more first", "Do it
 * tomorrow", "Yeah right" and "Yes. Actually, hmm" don't. Fails closed.
 */
export function isPlainYes(text: string | null): boolean {
  if (text === null) return false;
  const t = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return PLAIN_YES.has(t);
}
