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
  return ["heroOffer", p.detectorVersion, w.fromCivil, w.toCivil, w.zone, w.currency, p.totalCents, p.lateCents, [...w.purchaseIds].sort(), [...p.meetingIds].sort()];
}

const AFFIRM = /^(yes|yeah|yep|yup|sure|ok|okay|absolutely|definitely|let's do it|lets do it|let's do that|do it|go ahead|sounds good)\b/;
const NEGATION = /\b(no|not|don't|dont|never|nope|nah|wait|later|stop|cancel|maybe|can't|cant|won't|wont|but|except|skip|hold|rather|instead|without|unless|if)\b/;

/**
 * True when the owner's own words are a plain yes: they start with an affirmative and hold no negation or hedge.
 * "Yes." and "Yeah, let's do it" pass; "Yes, but not tonight", "Maybe" and "No" don't. Fails closed.
 */
export function isPlainYes(text: string | null): boolean {
  if (text === null) return false;
  const t = text.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  return AFFIRM.test(t) && !NEGATION.test(t);
}
