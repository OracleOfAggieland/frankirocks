/**
 * `reanchorRule`, pure (contracts §7 lines 825 and 840; spec §8 "What survives"). Maps a hard rule's proof span
 * onto the sanitized revision of its Evidence, verifies the quote and the gazetteer entry, and swaps its roots to
 * the survivor's. With no disjoint span, a quote that no longer matches, a gazetteer miss, or a subject that is not
 * literal in the span, the rule goes `pending` and anonymous: food is filtered as if anyone attends, no name or
 * erased root stays on it, and a card asks. A forget never withdraws a hard rule.
 */
import { type Hasher, rootKey } from "../ids";
import { evidenceFieldText } from "../evidence";
import { maxSens } from "../lexicon";
import { buildSlice } from "../slices";
import { findWholeWords, lookupAllergen } from "../writes/gazetteer";
import { FIRST_PERSON } from "../writes/subject";
import type { EID, ID, Sens } from "../schema/primitives";
import type { AllergyRule as AllergyRuleSchema, Evidence } from "../schema/records";
import type { Infer } from "../schema/v";

export type AllergyRule = Infer<typeof AllergyRuleSchema>;
export type SanitizeMapEntry = Evidence["sanitizeMap"][number];

/** A roster entity and the words that name it literally (labels and aliases). */
export interface RosterEntry {
  id: EID;
  names: string[];
}

export interface Survivor {
  eid: ID;
  evidence: Evidence;
}

export type PendingWhy = "noSurvivor" | "noDisjointSpan" | "quote" | "gazetteer" | "subject" | "noProof";

export type RuleReanchor = { kind: "reanchored"; rule: AllergyRule } | { kind: "pending"; rule: AllergyRule; why: PendingWhy };

/** The rule as a pending, anonymous food filter: no name, no proof, no erased roots (design note 021, gap 13). */
export function pendingRule(rule: AllergyRule): AllergyRule {
  return { ...rule, state: "pending", anonymous: true, subjectId: null, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
}

/** "my" and the first-person words count as a literal self (spec §8 "What survives"). */
const SELF_WORDS: ReadonlySet<string> = new Set([...FIRST_PERSON, "my", "mine"]);

function subjectLiteral(rule: AllergyRule, quote: string, roster: readonly RosterEntry[]): boolean {
  if (rule.subjectId === null) return true;
  if (rule.subjectId === "self") {
    const words = quote.toLowerCase().replace(/’/g, "'").match(/[a-z']+/g) ?? [];
    return words.some((w) => SELF_WORDS.has(w));
  }
  const entry = roster.find((r) => r.id === rule.subjectId);
  return entry !== undefined && entry.names.some((n) => findWholeWords(quote, n) !== null);
}

export function reanchorRule(rule: AllergyRule, map: readonly SanitizeMapEntry[], survivor: Survivor | null, roster: readonly RosterEntry[], hasher: Hasher): RuleReanchor {
  const pending = (why: PendingWhy): RuleReanchor => ({ kind: "pending", rule: pendingRule(rule), why });
  const p = rule.proof;
  if (p === null) return pending("noProof");
  if (survivor === null) return pending("noSurvivor");
  const seg = map.find((e) => e.oldField === p.fieldPath && e.oldStart <= p.start && p.end <= e.oldEnd);
  if (seg === undefined) return pending("noDisjointSpan");
  const start = seg.newStart + (p.start - seg.oldStart);
  const end = start + (p.end - p.start);
  const text = evidenceFieldText(survivor.evidence, seg.newField);
  if (text === null || end > text.length || text.slice(start, end) !== p.quote) return pending("quote");
  if (!lookupAllergen(p.quote).includes(rule.code)) return pending("gazetteer");
  if (!subjectLiteral(rule, p.quote, roster)) return pending("subject");
  const covering = survivor.evidence.fieldSlices.filter((s) => s.fieldPath === seg.newField && s.start !== null && s.end !== null && s.start <= start && end <= s.end);
  const cls = covering.some((s) => s.class === "U") ? "U" : covering.some((s) => s.class === "C") ? "C" : "M";
  const sens = covering.reduce<Sens>((acc, s) => maxSens(acc, s.sens), "S0");
  const slice = buildSlice({ eid: survivor.eid, fieldPath: seg.newField, fieldText: text, start, end, class: cls, sens }, hasher);
  return {
    kind: "reanchored",
    rule: {
      ...rule,
      proof: { eid: survivor.eid, fieldPath: seg.newField, start, end, quote: p.quote },
      proofRev: survivor.evidence.rev,
      rootKeys: [rootKey(slice, hasher)],
      dependsOn: [`e:${survivor.eid}`],
    },
  };
}
