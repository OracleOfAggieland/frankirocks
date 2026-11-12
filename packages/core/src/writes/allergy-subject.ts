/**
 * Whose allergy a model's subject may name (brief 043, W-231): an entityId or a mention chooses a person only when the
 * owner's own sentence around the span names that person, by the owner-words check of W-217 on the sentence's U
 * parts. Otherwise the subject is read as if the item carried none. Pure.
 */
import { coveringU, verifyTurnSpan } from "./spans";
import { namesOf, occurrences, phraseOwner } from "./life-subject";
import { RELATION_WORDS, knownNameWords } from "./subject";
import { wordTokens } from "./gazetteer";
import type { Subject, SubjectIndex, TurnEvidence, ValidateContext } from "./types";

/** Words that name a person other than the speaker on their own. "them", "it" and "that" point at the item instead. */
export const OTHER_PERSON_WORDS: ReadonlySet<string> = new Set(["he", "she", "him", "her", "his", "hers", "himself", "herself", "they", "their", "theirs", "themselves", "we", "us", "our", "ours", "ourselves"]);

/** True when `text` names someone besides the speaker: a word of OTHER_PERSON_WORDS, a relation word or a known name. */
export function namesAnother(text: string, known: SubjectIndex, entities: ValidateContext["entities"]): boolean {
  const names = knownNameWords(known, entities);
  return wordTokens(text).some((t) => {
    const stem = t.word.replace(/'(re|ve|ll|d|s)$/, "");
    return OTHER_PERSON_WORDS.has(t.word) || OTHER_PERSON_WORDS.has(stem) || RELATION_WORDS.has(stem) || names.has(stem);
  });
}

/** True when the owner's words in `[start, end)` of the turn name entity `id` as their own (a U part, W-217's phrase check). */
export function entityNamedIn(id: string, ev: TurnEvidence, range: { start: number; end: number }, known: SubjectIndex, entities: ValidateContext["entities"]): boolean {
  return namesOf(id, known, entities).some((n) => occurrences(ev.text, n, range.start, range.end).some((h) => coveringU(ev.slices, h.start, h.end) !== null && phraseOwner(ev.text, h.start, h.end) === "owner"));
}

/**
 * The subject the item may keep: an entityId the sentence doesn't name, or a mention that doesn't verify inside the
 * sentence, is dropped. With nothing left it becomes `isSelf` when the sentence holds a first person and names no one
 * else (`saidFirst`, `namesAnother`), else empty. Any other subject is returned as it is.
 */
export function allergySubject(s: Subject, ev: TurnEvidence, range: { start: number; end: number }, said: string, saidFirst: boolean, known: SubjectIndex, entities: ValidateContext["entities"]): Subject {
  if (s.isSelf) return s;
  let unsupported = false;
  if (s.mention !== null) {
    const m = verifyTurnSpan(s.mention, ev);
    unsupported = m === null || m.start < range.start || m.end > range.end;
  } else if (s.entityId !== null) unsupported = !entityNamedIn(s.entityId, ev, range, known, entities);
  if (!unsupported) return s;
  return saidFirst && !namesAnother(said, known, entities) ? { entityId: null, mention: null, isSelf: true } : { entityId: null, mention: null, isSelf: false };
}
