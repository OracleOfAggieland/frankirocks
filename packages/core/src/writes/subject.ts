/**
 * Subjects (design 2.4, rows SU1 to SU8; G7; CQ 102). Pure. Code links a mention against every entity it knows
 * (relation rows of `self`, rule subjects, the rename index): one match links, two or more ask, none derives the
 * EID from the words, as extraction's `resolveMention` does. Never a merge on a name.
 */
import type { Hasher } from "../ids";
import type { EID, Span } from "../schema/primitives";
import { wordTokens } from "./gazetteer";
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

/** First-person words (row SU2). */
export const FIRST_PERSON: ReadonlySet<string> = new Set(["i", "i'm", "i've", "i'd", "i'll", "me", "my", "mine", "myself"]);
const PRONOUNS = new Set(["he", "she", "him", "her", "they", "them", "it", "his", "hers", "their", "theirs", "this", "that", "someone", "somebody", "anyone", "everyone", "you", "we", "us"]);

/** True when the text holds a first-person word. */
export const hasFirstPerson = (text: string): boolean => wordTokens(text).some((t) => FIRST_PERSON.has(t.word));

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
  if (s.isSelf) return hasFirstPerson(i.quote) ? { kind: "resolved", id: "self", label: null } : { kind: "unresolved" }; // SU2, SU3
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

/** A subject's verified mention span, for cue sentences (design 2.5). */
export function mentionSpanOf(s: Subject, ev: TurnEvidence): Span | null {
  return s.mention === null ? null : verifyTurnSpan(s.mention, ev);
}
