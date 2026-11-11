/**
 * Subjects (design 2.4, rows SU1 to SU8; G7; CQ 102). Pure. Code links a mention against every entity it knows
 * (relation rows of `self`, rule subjects, the rename index): one match links, two or more ask, none derives the
 * EID from the words, as extraction's `resolveMention` does. Never a merge on a name.
 */
import type { Hasher } from "../ids";
import { REGEX_TABLE } from "../intents/regex";
import type { EID } from "../schema/primitives";
import { type WordToken, scanAliases, wordTokens } from "./gazetteer";
import { verifyTurnSpan } from "./spans";
import type { EntityKind, Subject, SubjectIndex, TurnEvidence } from "./types";

const DROPPED = /^(my|our|the)\s+/;

/** NFKC, lowercase, spaces collapsed, a leading "my", "our" or "the" dropped: the one function that turns words into a name. */
export function mentionName(words: string): string {
  return words.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().replace(DROPPED, "");
}

/** The code-derived EID of a mention: `H("mention", kind, name)`, as extraction's `resolveMention` derives it. */
export function mentionEid(kind: EntityKind, name: string, hasher: Hasher): EID {
  return hasher.id(["mention", kind, name]);
}

/** First-person words that name the speaker on their own (row SU2). */
export const FIRST_PERSON: ReadonlySet<string> = new Set(["i", "i'm", "i've", "i'd", "i'll", "me", "myself"]);
/** Possessives that name the speaker only when the allergy itself follows ("my allergy", "my peanut allergy"); "my brother" doesn't (CQ 149). */
const POSSESSIVE: ReadonlySet<string> = new Set(["my", "mine"]);
const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;
const PRONOUNS = new Set(["he", "she", "him", "her", "they", "them", "it", "his", "hers", "their", "theirs", "this", "that", "someone", "somebody", "anyone", "everyone", "you", "we", "us"]);

/**
 * Words for another person or a pet ("my brother", "my late husband"), so "my" before them doesn't name the speaker.
 * Read only for transitions (CQ 159); the names of known entities are added by the caller.
 */
export const RELATION_WORDS: ReadonlySet<string> = new Set([
  "mother", "mom", "mum", "mommy", "mummy", "mama", "ma", "father", "dad", "daddy", "papa", "pa", "pop", "pops", "parent", "parents", "folks",
  "brother", "sister", "sibling", "siblings", "bro", "sis", "twin", "son", "daughter", "child", "children", "kid", "kids", "baby", "babies",
  "wife", "husband", "spouse", "partner", "boyfriend", "girlfriend", "fiance", "fiancé", "fiancee", "fiancée", "ex", "date", "crush",
  "aunt", "auntie", "uncle", "cousin", "niece", "nephew", "grandma", "grandmother", "grandpa", "grandfather", "granny", "nana", "nan",
  "grandson", "granddaughter", "grandchild", "grandkids", "grandparent", "grandparents", "stepmom", "stepmother", "stepdad", "stepfather",
  "stepson", "stepdaughter", "stepbrother", "stepsister", "family", "relative", "relatives",
  "friend", "friends", "bestie", "buddy", "pal", "mate", "roommate", "flatmate", "housemate", "neighbor", "neighbour", "neighbors", "neighbours",
  "boss", "manager", "colleague", "colleagues", "coworker", "coworkers", "co", "teammate", "employee", "assistant", "client", "mentor",
  "coach", "teacher", "student", "doctor", "therapist", "nurse", "landlord", "landlady", "tenant",
  "dog", "cat", "pet", "pets", "puppy", "kitten", "horse",
]);
/** Words that may stand between "my" and the word it governs ("my little brother", "my new job"). */
const MODIFIERS: ReadonlySet<string> = new Set(["little", "big", "older", "younger", "elder", "eldest", "oldest", "youngest", "best", "late", "dear", "old", "new", "own", "step", "half", "great", "favorite", "favourite", "former", "current"]);
/**
 * The only words an answer may hold beside "mine" for "mine" to name the speaker (answering rule 2; CQ 159, amended
 * by CQ 160): fillers, pointers, the copula, negation and a few adverbs. Any other word ("and my brother's", "of",
 * "with the dog") means the answer may name someone else, so it fails closed. Cue words and aliases count too.
 */
const MINE_CONTEXT: ReadonlySet<string> = new Set([
  "oh", "um", "uh", "well", "yes", "yeah", "yep", "yup", "ok", "okay", "so",
  "it", "that", "this", "one", "the", "is", "was",
  "no", "nope", "not", "never", "isn't", "wasn't",
  "too", "also", "definitely", "actually", "really", "just", "only", "all", "sure", "honestly", "totally",
]);

/**
 * How SU2 reads "my" and "mine" (CQ 149, amended by CQ 159 and CQ 160). `allergy`: only before the allergy itself.
 * `answer` (an allergy item on an answering turn): also "mine" in an answer of answer words only, negated or not.
 * `transition`: also "my" before a word that names no other person or pet ("my job", "my marriage"); `others` holds
 * the words of every known name.
 */
export type SelfReading = { kind: "allergy" } | { kind: "answer" } | { kind: "transition"; others: ReadonlySet<string> };

const ALLERGY_READING: SelfReading = { kind: "allergy" };

/** "my" followed, past any modifiers, by a word that names no other person or pet. */
function myOwnThing(w: readonly { word: string }[], i: number, others: ReadonlySet<string>): boolean {
  for (let k = i + 1; k < w.length && k <= i + 3; k++) {
    const word = w[k]!.word;
    if (RELATION_WORDS.has(word) || others.has(word)) return false;
    if (!MODIFIERS.has(word)) return true;
  }
  return false;
}

/**
 * An answer holding "mine" and otherwise only `MINE_CONTEXT` words, RX4 words or alias words: "Mine.", "Mine too.",
 * "It's mine.", "The allergy is mine.", and negated, "Not mine.", "It isn't mine." (CQ 160). Tokens are in normal
 * form, where a final 's is dropped, so "it's" reads as "it" and "one's" as "one".
 */
function mineAnswers(text: string, w: readonly WordToken[]): boolean {
  if (!w.some((t) => t.word === "mine")) return false;
  const aliases = scanAliases(text);
  return w.every((t) => t.word === "mine" || MINE_CONTEXT.has(t.word) || RX4.test(t.word) || aliases.some((h) => h.start <= t.start && t.end <= h.end));
}

/** Words that name a person on their own, for row A9 (CQ 160); "it", "that" and "them" point at the item. */
const PERSON_WORDS: ReadonlySet<string> = new Set([
  ...FIRST_PERSON, "my", "mine", "our", "ours", "we", "us", "ourselves",
  "he", "she", "him", "her", "his", "hers", "himself", "herself", "they", "their", "theirs", "themselves",
]);

/** The words of every name a subject could be matched by: labels, aliases and relation words of `known` and `entities`. */
export function knownNameWords(known: SubjectIndex, entities: SubjectInput["entities"]): Set<string> {
  const out = new Set<string>();
  const add = (w: string | null) => {
    if (w === null) return;
    for (const t of wordTokens(mentionName(w))) out.add(t.word);
  };
  for (const e of known.entries) for (const w of [e.label, ...e.aliases, e.relation]) add(w);
  for (const e of entities) for (const w of [e.label, ...e.aliases]) add(w);
  return out;
}

/**
 * True when the text names a person (row A9's guard, CQ 160): a first-person or third-person word, "my", "mine",
 * "our", a relation or pet word, or a word of a known name. A contraction counts by its stem ("we're", "they've").
 */
export function namesSomeone(text: string, others: ReadonlySet<string>): boolean {
  return wordTokens(text).some((t) => {
    const stem = t.word.replace(/'(re|ve|ll|d|m)$/, "");
    return PERSON_WORDS.has(t.word) || PERSON_WORDS.has(stem) || RELATION_WORDS.has(stem) || others.has(stem);
  });
}

/**
 * True when the text names the speaker: a first-person word, or "my"/"mine" right before an RX4 word or an alias;
 * and, by `reading`, the answer "Mine." or a transition's "my job".
 */
export function hasFirstPerson(text: string, reading: SelfReading = ALLERGY_READING): boolean {
  const w = wordTokens(text);
  if (reading.kind === "answer" && mineAnswers(text, w)) return true;
  return w.some((t, i) => {
    if (FIRST_PERSON.has(t.word)) return true;
    const next = w[i + 1];
    if (!POSSESSIVE.has(t.word) || next === undefined) return false;
    if (RX4.test(next.word) || scanAliases(text).some((h) => h.start === next.start)) return true;
    return reading.kind === "transition" && t.word === "my" && myOwnThing(w, i, reading.others);
  });
}

export type SubjectResult = { kind: "resolved"; id: EID; label: string | null } | { kind: "ambiguous" } | { kind: "unresolved" };

export interface SubjectInput {
  subject: Subject;
  /** The item's verified quote: where SU2 looks for a first-person word. */
  quote: string;
  evidence: TurnEvidence;
  known: SubjectIndex;
  entities: readonly { id: EID; label: string; aliases: readonly string[] }[];
  /** The kind a new mention gets (a move's counterpart: place; else person). */
  kind: EntityKind;
  /** How SU2 reads "my" and "mine": an allergy item, one on an answering turn, or a transition (CQ 159). */
  reading: SelfReading["kind"];
  hasher: Hasher;
}

const ENTITY_KINDS: readonly EntityKind[] = ["person", "pet", "place", "organization", "artifact", "occasion", "topic"];

/** Everything a name can match: known entries, then the entities sent, one per ID. */
function candidates(i: SubjectInput): { id: EID; label: string; names: Set<string> }[] {
  const byId = new Map<EID, { id: EID; label: string; names: Set<string> }>();
  const add = (id: EID, label: string, words: readonly (string | null)[]) => {
    const c = byId.get(id) ?? { id, label, names: new Set<string>() };
    for (const w of words) if (w !== null && w.trim() !== "") c.names.add(mentionName(w));
    byId.set(id, c);
  };
  for (const e of i.known.entries) add(e.id, e.label, [e.label, ...e.aliases, e.relation]);
  for (const e of i.entities) add(e.id, e.label, [e.label, ...e.aliases]);
  return [...byId.values()];
}

/** SU2's reading for this input; a transition's carries the words of every name it could mean. */
function readingOf(i: SubjectInput): SelfReading {
  if (i.reading !== "transition") return { kind: i.reading };
  const others = new Set<string>();
  for (const c of candidates(i)) for (const n of c.names) for (const t of wordTokens(n)) others.add(t.word);
  return { kind: "transition", others };
}

/** "my brother" becomes "your brother"; other words stay as the owner said them. */
const ownerLabel = (words: string): string =>
  words
    .trim()
    .replace(/^(my|our)\s+/i, "your ")
    .slice(0, 80);

/** The subject table: the first matching row decides. */
export function resolveSubject(i: SubjectInput): SubjectResult {
  const s = i.subject;
  const mention = s.mention === null ? null : verifyTurnSpan(s.mention, i.evidence);
  const forms = (s.isSelf ? 1 : 0) + (s.entityId !== null ? 1 : 0) + (s.mention !== null ? 1 : 0);
  if (forms > 1) {
    // SU1, except an entityId with a mention that names that same entity.
    const sameEntity = !s.isSelf && s.entityId !== null && mention !== null && candidates(i).some((c) => c.id === s.entityId && c.names.has(mentionName(mention.quote)));
    if (!sameEntity) return { kind: "unresolved" };
  }
  if (s.isSelf) return hasFirstPerson(i.quote, readingOf(i)) ? { kind: "resolved", id: "self", label: null } : { kind: "unresolved" }; // SU2, SU3
  if (s.entityId !== null) {
    const e = i.entities.find((x) => x.id === s.entityId);
    if (e !== undefined) return { kind: "resolved", id: e.id, label: e.label }; // SU4
    if (mention === null) return { kind: "unresolved" };
  }
  if (mention === null) return { kind: "unresolved" }; // SU8: nothing, or a mention that doesn't verify
  const name = mentionName(mention.quote);
  if (name === "" || PRONOUNS.has(name)) return { kind: "unresolved" }; // SU8
  const hits = candidates(i).filter((c) => c.names.has(name));
  if (hits.length === 1) return { kind: "resolved", id: hits[0]!.id, label: hits[0]!.label }; // SU5
  if (hits.length > 1) return { kind: "ambiguous" }; // SU6
  // SU7: the one derived EID, with and without the dropped word, that some Memory already names; else a new one.
  const raw = mention.quote.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  const seen = i.known.seen ?? new Set<string>();
  const found = new Set<EID>();
  for (const k of ENTITY_KINDS) for (const n of new Set([name, raw])) if (seen.has(mentionEid(k, n, i.hasher))) found.add(mentionEid(k, n, i.hasher));
  if (found.size === 1) return { kind: "resolved", id: [...found][0]!, label: ownerLabel(mention.quote) };
  if (found.size > 1) return { kind: "ambiguous" };
  return { kind: "resolved", id: mentionEid(i.kind, name, i.hasher), label: ownerLabel(mention.quote) };
}
