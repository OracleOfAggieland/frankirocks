/**
 * "Asked" and doors, decided by code (spec §6 lines 216 and 220). Only the owner's own words this turn count: class
 * U or C, speaker certain. The voice model's words never open anything.
 */
import { tokenize } from "../text";
import { FUNCTION_WORDS } from "../whisper/added-facts";
import type { GateCandidate, GateContext, GateTopic } from "./types";

/** Shortest token that counts, as in `recallTerms`: a lone "s" from "dog's" must not match. */
export const MIN_TERM_CHARS = 2;

/** Function words never count as a query term or door term ("It is late" does not ask `recall("is mom ok")`). */
const terms = (words: readonly string[]) => words.flatMap((w) => tokenize(w)).filter((t) => t.length >= MIN_TERM_CHARS && !FUNCTION_WORDS.has(t));

/** The owner's tokens this turn, or null when the words can't open or ask anything. */
export function ownerTokens(x: Pick<GateContext, "ownerTurn">): Set<string> | null {
  const t = x.ownerTurn;
  if (t === null || typeof t !== "object" || t.certain !== true) return null;
  if (t.sourceClass !== "U" && t.sourceClass !== "C") return null;
  if (typeof t.text !== "string") return null;
  return new Set(tokenize(t.text));
}

/**
 * A recall result counts as asked only on the recall trigger, when the owner's own words hold one of the candidate's
 * own aliases or open its topic (brief 033 finding 3). The model's query terms never count.
 */
export function askedByOwner(c: Pick<GateCandidate, "aliases" | "topic">, x: Pick<GateContext, "ownerTurn" | "trigger">): boolean {
  if (x.trigger !== "recall") return false;
  const words = ownerTokens(x);
  if (words === null) return false;
  return terms(c.aliases).some((q) => words.has(q)) || (c.topic !== null && doorOpens(c.topic, x));
}

/**
 * `opens(label)`: every label token of two or more characters is in the owner's words, function words included, and
 * the label has at least one word that is not a function word (brief 033 finding 18: dropping a label's function
 * words first made a label easier to open than the spec's rule).
 */
export function opensLabel(label: string, words: ReadonlySet<string>): boolean {
  const need = tokenize(label).filter((t) => t.length >= MIN_TERM_CHARS);
  return need.some((t) => !FUNCTION_WORDS.has(t)) && need.every((t) => words.has(t));
}

/** A door opens this turn only on a term match or `opensLabel`, and only for a label and terms from U, C or O. */
export function doorOpens(topic: GateTopic, x: Pick<GateContext, "ownerTurn">): boolean {
  if (topic.labelClass !== "U" && topic.labelClass !== "C" && topic.labelClass !== "O") return false;
  const words = ownerTokens(x);
  if (words === null) return false;
  return terms(topic.terms).some((t) => words.has(t)) || opensLabel(topic.label, words);
}

/** The topic is open: opened earlier this Session, or its door opens on this turn's words. */
export function topicOpen(c: Pick<GateCandidate, "topic">, x: Pick<GateContext, "ownerTurn" | "openedTopics">): boolean {
  const t = c.topic;
  if (t === null) return false;
  if (t.labelClass !== "U" && t.labelClass !== "C" && t.labelClass !== "O") return false;
  return x.openedTopics.includes(t.topicId) || doorOpens(t, x);
}
