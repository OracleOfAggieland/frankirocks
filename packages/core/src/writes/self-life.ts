/**
 * The owner as the subject of their own life change (brief 043, finding 6). Pure.
 *
 * For an illness or a recovery, `isSelf` plus any first-person word was enough to record the owner ill ("I just found
 * out my brother was diagnosed"). Now the owner's words must make the first person the subject of the change by one of
 * a closed list of forms, and a span that also names a relation word or a known name defers: code can't tell whose
 * illness it is.
 */
import { RELATION_WORDS } from "./subject";

/**
 * The closed list of first-person life-change forms (a ruling for this build, brief 043; question W-212), over the
 * span in lowercase with curly apostrophes straight. Adverbs that may sit inside are listed in each form.
 */
export const SELF_LIFE_FORMS: readonly RegExp[] = [
  /\bi( (just|recently|finally|also|was just|was recently))? (was|got|have been|'ve been) (diagnosed|hospitali[sz]ed|admitted)\b/,
  /\bi('ve| have)( (just|recently|finally|also))? (been diagnosed|been (sick|ill|unwell)|recovered|got (the|a|an|covid|cancer|flu)|caught)\b/,
  /\bi( (just|recently|finally|also))? (have|got|caught|fell|came down with|tested positive)\b( (the|a|an|cancer|covid|flu|ill|sick|for))?/,
  /\bi('m| am)( (so|really|very|still|now|finally|feeling|getting|doing))* (sick|ill|unwell|better|recovering|recovered|in (the )?hospital|cancer[- ]free|on the mend|okay now|fine now)\b/,
  /\bi( (just|finally))? (got|am getting|'m getting|feel|felt) (better|well again|sick|ill)\b/,
];

/** True when the span makes the owner the subject of a life change and names no one else. */
export function selfIsLifeSubject(span: string, others: ReadonlySet<string>): boolean {
  const t = span.normalize("NFKC").toLowerCase().replace(/[‘’ʼ]/g, "'");
  const words = t.split(/[^\p{L}\p{N}']+/u).filter((w) => w !== "").map((w) => w.replace(/'s$/, ""));
  if (words.some((w) => RELATION_WORDS.has(w) || others.has(w))) return false;
  return SELF_LIFE_FORMS.some((re) => re.test(t));
}
