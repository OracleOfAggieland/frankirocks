/**
 * Who a life change happened to, by the owner's words (brief 043, finding 1). Pure.
 *
 * A model's subject (an `entityId`, or a mention span) never chooses on its own who died, fell ill or moved. The
 * words that name the subject must be a whole noun phrase that is the speaker's own: "my mom", "Dad", "my friend Sam".
 * A possessive owner before them ("my friend's mom", "Sam's dad", "his mom"), a possessive after them ("my mom's
 * dog"), "of" ("the mom of a friend"), or a determiner that isn't the speaker's ("a mom at school", "the dad") means
 * the stored entity is not the subject, and code can't settle the chain, so the change is deferred. An `entityId`
 * alone counts only when its own name stands in the span, and every time it stands there it passes the same test.
 */
import type { EID, Span } from "../schema/primitives";
import { mentionName, RELATION_WORDS } from "./subject";
import { verifyTurnSpan } from "./spans";
import type { Subject, SubjectIndex, TurnEvidence } from "./types";

/** Words that make the phrase after them the speaker's own: "my dad", "our dog". */
export const OWNER_POSSESSIVES: ReadonlySet<string> = new Set(["my", "our"]);

/**
 * Words that make the phrase after them someone else's, or no one's in particular. A word ending in "'s" or "s'"
 * ("friend's", "Sam's", "parents'") is read the same way, separately.
 */
export const OTHER_OWNERS: ReadonlySet<string> = new Set([
  "his", "her", "their", "your", "its", "whose", "a", "an", "the", "this", "that", "these", "those", "some", "one", "any", "every", "each", "another", "someone",
]);

/** Words that may stand between the owner word and the name, read through: "my late dad", "my friend Sam". */
export const PHRASE_MODIFIERS: ReadonlySet<string> = new Set([
  "little", "big", "older", "younger", "elder", "eldest", "oldest", "youngest", "best", "late", "dear", "old", "new", "own", "step", "half", "great", "favorite", "favourite", "former", "current", "beloved", "sweet", "poor",
]);

/**
 * Words that, right after a name's "'s", make it "is" or "has" rather than a possessive: "my mom's in the hospital",
 * "my dad's been ill", "Sam's a nurse". Any other word after "'s" ("my mom's dog") reads as a possessive.
 */
export const CONTRACTION_NEXT: ReadonlySet<string> = new Set([
  "in", "at", "on", "out", "home", "back", "away", "been", "being", "had", "got", "gotten", "gone", "going", "getting", "doing", "having",
  "not", "never", "still", "now", "just", "really", "very", "so", "too", "always", "finally", "already", "also",
  "sick", "ill", "unwell", "dead", "dying", "passed", "fine", "ok", "okay", "better", "worse", "recovering", "pregnant", "retired", "moving", "leaving",
  "a", "an", "the",
]);

/** Words after a name that hand it to a later head: "the mom of my friend". */
export const PHRASE_LINKS: ReadonlySet<string> = new Set(["of"]);

const WORD = /[\p{L}\p{N}]+(?:['‘’ʼ][\p{L}\p{N}]+)*['‘’ʼ]?/gu;
const POSSESSIVE_WORD = /['‘’ʼ](s)?$/u;

interface Tok {
  raw: string;
  word: string;
  start: number;
  end: number;
}

function tokens(text: string): Tok[] {
  return [...text.matchAll(WORD)].map((m) => ({ raw: m[0], word: m[0].normalize("NFKC").toLowerCase().replace(/[‘’ʼ]/g, "'"), start: m.index!, end: m.index! + m[0].length }));
}

const possessive = (t: Tok) => POSSESSIVE_WORD.test(t.word) && !/^(it's|that's|what's|who's|there's|here's|he's|she's|let's)$/.test(t.word);
/** Only spaces stand between two offsets: no comma, stop or bracket ends the phrase there. */
const joined = (text: string, from: number, to: number) => /^\s*$/u.test(text.slice(from, to));

/**
 * Whose the noun phrase `text[start, end)` is: `owner` when the words make it the speaker's own (or a bare name),
 * `other` when they make it someone else's, or when code can't tell.
 */
export function phraseOwner(text: string, start: number, end: number): "owner" | "other" {
  const all = tokens(text);
  // A token cut by the end ("mom" of "mom's") counts whole, so its "'s" is read below.
  const inside = all.filter((t) => t.start >= start && t.start < end && (t.end <= end || POSSESSIVE_WORD.test(t.word)));
  if (inside.length === 0) return "other";
  // Inside the phrase: a possessive or "of" is a chain ("friend's mom"), never settled by code.
  if (inside.some((t, i) => (possessive(t) && i < inside.length - 1) || PHRASE_LINKS.has(t.word))) return "other";
  const last = inside[inside.length - 1]!;
  const afterLast = all[all.indexOf(last) + 1];
  if (possessive(last) && !(/['‘’ʼ]s$/u.test(last.word) && afterLast !== undefined && CONTRACTION_NEXT.has(afterLast.word))) return "other";
  // After the phrase: "'s" or "of" means the phrase only owns the real head ("my mom's dog"), unless the "'s" is
  // "is" or "has" by the word after it ("my mom's in the hospital").
  const nextAt = all.findIndex((t) => t.start >= end);
  const next = nextAt < 0 ? undefined : all[nextAt];
  if (/^['‘’ʼ]/u.test(text.slice(end))) {
    const after = all.find((t) => t.start > end + 1);
    if (!(/^['‘’ʼ]s\s/u.test(text.slice(end)) && after !== undefined && CONTRACTION_NEXT.has(after.word))) return "other";
  }
  if (next !== undefined && joined(text, end, next.start) && PHRASE_LINKS.has(next.word)) return "other";
  // The phrase's own first word may be the owner word.
  const first = inside[0]!;
  if (OWNER_POSSESSIVES.has(first.word)) return "owner";
  if (OTHER_OWNERS.has(first.word)) return "other";
  // Before the phrase: read back through modifiers and relation words ("my late dad", "my friend Sam").
  let i = all.indexOf(first) - 1;
  let edge = first.start;
  while (i >= 0) {
    const t = all[i]!;
    if (!joined(text, t.end, edge)) break;
    if (possessive(t)) return "other";
    if (OWNER_POSSESSIVES.has(t.word)) return "owner";
    if (OTHER_OWNERS.has(t.word)) return "other";
    if (!PHRASE_MODIFIERS.has(t.word) && !RELATION_WORDS.has(t.word)) break;
    edge = t.start;
    i--;
  }
  return "owner";
}

/** Every whole-word occurrence of `name` in `text[from, to)`, case and spacing folded. */
export function occurrences(text: string, name: string, from = 0, to = text.length): { start: number; end: number }[] {
  const want = tokens(name).map((t) => t.word);
  if (want.length === 0) return [];
  const all = tokens(text).filter((t) => t.start >= from && t.end <= to);
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i + want.length <= all.length; i++) {
    const words = all.slice(i, i + want.length);
    const w = words.map((t, k) => (k === words.length - 1 ? t.word.replace(POSSESSIVE_WORD, "") : t.word));
    if (w.every((x, k) => x === want[k])) out.push({ start: words[0]!.start, end: words[words.length - 1]!.end });
  }
  return out;
}

/** The names a known entity can be said by: its labels, aliases and relation word, as `mentionName` reads them. */
export function namesOf(id: EID, known: SubjectIndex, entities: readonly { id: EID; label: string; aliases: readonly string[] }[]): string[] {
  const out = new Set<string>();
  for (const e of known.entries) if (e.id === id) for (const w of [e.label, ...e.aliases, e.relation]) if (w !== null && mentionName(w) !== "") out.add(mentionName(w));
  for (const e of entities) if (e.id === id) for (const w of [e.label, ...e.aliases]) if (mentionName(w) !== "") out.add(mentionName(w));
  return [...out];
}

export interface LifeSubjectInput {
  subject: Subject;
  /** The item's verified span. */
  span: Span;
  evidence: TurnEvidence;
  known: SubjectIndex;
  entities: readonly { id: EID; label: string; aliases: readonly string[] }[];
}

/**
 * True when the owner's words settle the subject a model gave for a life change: a mention that verifies and is a
 * whole phrase of the speaker's own, or an entity whose name stands in the span, each time as such a phrase. `isSelf`
 * and an empty subject pass here; the subject table and finding 6's first-person forms read those.
 */
export function ownerWordsSettle(i: LifeSubjectInput): boolean {
  const s = i.subject;
  if (s.isSelf && s.entityId === null && s.mention === null) return true;
  const text = i.evidence.text;
  if (s.mention !== null) {
    const m = verifyTurnSpan(s.mention, i.evidence);
    return m !== null && phraseOwner(text, m.start, m.end) === "owner";
  }
  if (s.entityId === null) return true;
  const hits = namesOf(s.entityId, i.known, i.entities).flatMap((n) => occurrences(text, n, i.span.start, i.span.end));
  return hits.length > 0 && hits.every((h) => phraseOwner(text, h.start, h.end) === "owner");
}

/**
 * Extraction's half (finding 1): a `person.life` Memory about someone other than the owner is written only when the
 * subject mention's verified words (`text[start, end)`) say the same name the mention gives and are a whole phrase of
 * the speaker's own. `null` (no mention, or a span that doesn't verify) never passes.
 */
export function lifeMentionOwned(said: { text: string; start: number; end: number } | null, observedName: string): boolean {
  if (said === null) return false;
  const quote = said.text.slice(said.start, said.end);
  if (mentionName(quote) !== mentionName(observedName)) return false;
  return phraseOwner(said.text, said.start, said.end) === "owner";
}
