/**
 * Validation (design 2.4): spans, authority per covering slice, act, speaker, subject, value and gazetteer, one
 * verdict per item. Pure; writes nothing. Models read and extract; code decides here what may be written.
 *
 * Before every table: an item whose route no trigger opened is `outOfScope` (G38), and a `kind: rule` item is
 * `outOfScope` (G31). Then each table's rows run in order; the first that matches decides.
 */
import { REGEX_TABLE, normalizeForRegex } from "../intents/regex";
import { civilDateAt, looksLikeTime, resolveSpoken } from "../dates";
import { canonicalJSON } from "../ids";
import type { EID, Span, Value } from "../schema/primitives";
import { checkPredicateFit } from "../schema/predicates";
import type { Memory } from "../schema/records";
import { msFromTs } from "../schema/primitives";
import { NONE_CODE, findWholeWords, lookupAllergen, scanAliases, wordTokens } from "./gazetteer";
import { protectedRow } from "./correction";
import { scopeOf } from "./keys";
import { sameValue } from "./plan";
import { plainMention } from "./not-allergy";
import { hasFirstPerson, knownNameWords, mentionEid, mentionName, namesSomeone, resolveSubject, type SubjectInput, type SubjectResult } from "./subject";
import { GENERIC_WORDS, REFERENCE_WORDS, itemNamesNothing } from "./names-own";
import { ownerWordsSettle } from "./life-subject";
import { selfIsLifeSubject } from "./self-life";
import { renameRefuted } from "./rename-words";
import { retractionSaid } from "./retract-words";
import { spanClass, verifyTurnSpan } from "./spans";
import type { AllergyVerdict, ArgPair, CorrectionVerdict, EntityKind, FastItem, FastSlotsOut, ItemVerdict, Need, QuestionKind, Route, Subject, TransitionKind, TransitionVerdict, ValidateContext } from "./types";

/** `handled`'s bounds (design 5): a correction or change past them defers; nothing is truncated. */
export const HANDLED_KEYS_MAX = 8;
export const HANDLED_REFS_MAX = 16;

/**
 * Ruling for this build (brief 018 task 0 item 3, for the owner to confirm): answering rule 2 lends the asked rule's
 * subject only when the answer's span names no one. "Not mine." about the brother's pending rule is then a denial for
 * `self`, and the brother's rule stays.
 */
export const LEND_ONLY_WHEN_NAMES_NO_ONE = true;

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;
const NEGATION = new Set(["not", "no", "never", "none", "nothing", "nope", "outgrew", "outgrown"]);

/** Row A5: a negation word (not, n't, no, never, none, nothing, no longer, nope, outgrew, outgrown). */
export function hasNegation(text: string): boolean {
  return wordTokens(text).some((t) => NEGATION.has(t.word) || t.word.endsWith("n't"));
}

export { GENERIC_WORDS, REFERENCE_WORDS } from "./names-own";

/** The allergy cue words themselves (RX4's allergy and intolerance words, not "celiac" or "epipen"): "allergic", "that allergy". */
const CUE_WORD = /^(allerg(y|ies|ic)|intoleran(t|ce))$/;

/**
 * True when the item, read alone, names nothing of its own (CQ 156, amended by CQ 161). Kept for callers that have no
 * span; validation reads the span too, through `itemNamesNothing` (brief 018 task 0).
 */
export function namesNothing(item: string): boolean {
  const words = wordTokens(item);
  if (words.length === 0) return true;
  return words.every((t) => REFERENCE_WORDS.has(t.word) || GENERIC_WORDS.has(t.word) || CUE_WORD.test(t.word)) && lookupAllergen(item).length === 0;
}

const routeOf = (item: FastItem): Route | null =>
  item.kind === "allergy" ? "hardRule" : item.kind === "correction" ? "correct" : item.kind === "transition" ? "transition" : null;

/** Name/value pairs back to Args (CQ 122). A repeated name keeps the last value. */
export function decodeArgs(pairs: readonly ArgPair[] | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of pairs ?? []) out[p.name] = p.value;
  return out;
}

interface Budget {
  keys: Set<string>;
  refs: number;
}

export function validateItems(out: FastSlotsOut, ctx: ValidateContext): ItemVerdict[] {
  const budget: Budget = { keys: new Set(), refs: 0 };
  return out.items.map((item, index) => validateOne(item, index, out.need, ctx, budget));
}

function validateOne(item: FastItem, index: number, need: Need, ctx: ValidateContext, budget: Budget): ItemVerdict {
  const route = routeOf(item);
  if (route === null || !ctx.routes.has(route)) return { kind: "ignored", index, reason: "outOfScope" };
  switch (item.kind) {
    case "allergy":
      return allergyVerdict(item, index, need, ctx);
    case "correction":
      return correctionVerdict(item, index, need, ctx, budget);
    case "transition":
      return transitionVerdict(item, index, need, ctx, budget);
    default:
      return { kind: "ignored", index, reason: "outOfScope" };
  }
}

const subjectOf = (s: Subject, quote: string, ctx: ValidateContext, kind: EntityKind, reading: SubjectInput["reading"]): SubjectResult =>
  resolveSubject({ subject: s, quote, evidence: ctx.evidence, known: ctx.known, entities: ctx.entities, kind, reading, hasher: ctx.hasher });

const isEmptySubject = (s: Subject) => !s.isSelf && s.entityId === null && s.mention === null;

// ---------------------------------------------------------------------------------------------
// Allergy items (rows A1 to A16, and the answering rules)

function allergyVerdict(item: Extract<FastItem, { kind: "allergy" }>, index: number, need: Need, ctx: ValidateContext): ItemVerdict {
  const ignored = (reason: "authority" | "span" | "act" | "target") => ({ kind: "ignored" as const, index, reason });
  const ok = (v: AllergyVerdict): ItemVerdict => ({ kind: "allergy", index, v });
  if (spanClass(item.span, ctx.evidence) !== "U") return ignored("authority"); // A1
  const span = verifyTurnSpan(item.span, ctx.evidence);
  if (span === null) return ignored("span"); // A2
  const answering = ctx.answering !== null;
  const R = ctx.answering?.rule ?? null;
  const hasNeg = hasNegation(span.quote);
  let polarity = item.polarity === "denied" && !hasNeg ? "uncertain" : item.polarity; // A5

  // Codes come from `item`, once it is found inside the verified quote (A3). Answering rules 1 and 3 fill them from
  // the asked rule R when the answer names nothing of its own ("Yes.", "No.", "it", "that stuff", "allergic"; CQ 161);
  // rule 4 then takes R's proof. An
  // item found in the span that the gazetteer doesn't know ("durian", "something") is another thing named: its codes
  // stay empty and it never answers R (CQ 156).
  // Task 0 (brief 018): the span is read as well as the item. R is answered, or its code taken, only when every
  // alias in the span is R's own (`spanFitsR`), and the item names nothing of its own in that span (`names-own.ts`).
  const aliasesInSpan = scanAliases(span.quote);
  const askedCode = R !== null && R.code !== "unresolved" ? R.code : null;
  const spanFitsR = R !== null && aliasesInSpan.every((a) => a.code === R.code);
  const itemInSpan = item.item.trim() !== "" && findWholeWords(span.quote, item.item) !== null;
  const namesOwn = answering ? !itemNamesNothing(itemInSpan ? item.item : "", span.quote, askedCode) : itemInSpan && !namesNothing(item.item);
  let codes: string[];
  let proof: Span = span;
  if (answering && R !== null && askedCode !== null && spanFitsR && !namesOwn) {
    if (polarity === "denied") codes = [R.code];
    else if (aliasesInSpan.length > 0) codes = [R.code]; // rule 4: the answer's own span names the allergen
    else if (R.proof !== null) {
      codes = [R.code];
      proof = R.proof;
    } else return ignored("span");
  } else if (!itemInSpan) {
    if (!(answering && polarity === "denied")) return ignored("span"); // A3
    codes = [];
  } else codes = lookupAllergen(item.item);
  if (item.act !== "direct") return ignored("act"); // A4

  // Subjects; answering rule 2 for an item with none. A mention that isn't plain (longer than a name, or holding the
  // allergy word itself: "my brother with the peanut allergy") names no one, so the item fails closed (CQ 150). On an
  // answering turn "Mine." and "Not mine." name the speaker too (CQ 159, CQ 160).
  const reading = answering ? "answer" : "allergy";
  const mentionQuote = item.subject.mention === null ? null : (verifyTurnSpan(item.subject.mention, ctx.evidence)?.quote ?? null);
  let subject: SubjectResult;
  // Answering rule 2, narrowed (brief 018 task 0, item 3): R's subject is lent only when the answer's span names no
  // one (`LEND_ONLY_WHEN_NAMES_NO_ONE`). An item marked `isSelf` whose words hold no first person ("It's a real
  // reaction.") is read as naming no one too (item 2). When the span names someone, the subject comes from the words.
  const namesNoOneHere = !namesSomeone(span.quote, knownNameWords(ctx.known, ctx.entities));
  const selfOnly = item.subject.isSelf && item.subject.entityId === null && item.subject.mention === null;
  const lend = answering && R !== null && R.subjectId !== null && (!LEND_ONLY_WHEN_NAMES_NO_ONE || namesNoOneHere) && (isEmptySubject(item.subject) || (selfOnly && namesNoOneHere && !hasFirstPerson(span.quote, { kind: reading })));
  if (lend) subject = { kind: "resolved", id: R!.subjectId!, label: null };
  else if (answering && isEmptySubject(item.subject)) {
    subject = hasFirstPerson(span.quote, { kind: reading }) ? { kind: "resolved", id: "self", label: null } : { kind: "unresolved" };
  } else if (mentionQuote !== null && !plainMention(mentionQuote)) subject = { kind: "unresolved" };
  else subject = subjectOf(item.subject, span.quote, ctx, "person", reading);
  const resolved = subject.kind === "resolved" ? subject : null;

  if (polarity === "denied") {
    // A6: a ledger decision only, carrying the codes verified above (never the model's raw `item`, CQ 148).
    if (!ctx.speakerCertain) return { kind: "ignored", index, reason: "speaker", codes: codes.filter((c) => c !== NONE_CODE) };
    const onlyNone = codes.length > 0 && codes.every((c) => c === NONE_CODE);
    if (resolved !== null && onlyNone) return ok({ kind: "deny", subject: resolved.id, scope: "global", proof: span }); // A7
    if (resolved !== null) return ok({ kind: "deny", subject: resolved.id, scope: "specific", codes: codes.filter((c) => c !== NONE_CODE), proof: span }); // A8
    // A9: only a denial that names no other allergen answers R ("No.", "Nobody's allergic to anything"; CQ 145), and
    // an item the gazetteer doesn't know is another allergen named ("Nobody's allergic to durian"; CQ 156). A denial
    // whose span names a person ("My brother doesn't.", "Not her.") says only that it isn't theirs, so it never
    // answers R (CQ 160).
    // Task 0: and only when every alias in the span is R's own ("No, nobody is allergic to shellfish." never clears
    // an anonymous peanut rule).
    if (answering && R !== null && R.anonymous && namesNoOneHere && spanFitsR && ((codes.length === 0 && !namesOwn) || onlyNone || codes.includes(R.code))) return ok({ kind: "deny", answers: R.id, proof: span }); // A9
    // A10 on an answering turn: a certain, direct denial answering Franki's own question keeps the asked rule as it
    // is, so the fallback never adds the all-food filter for a "no" (CQ 161).
    if (answering && R !== null) return ok({ kind: "pendingKept", ruleId: R.id, question: null }); // A10, answering
    // A10. The design names the reason `act`; `target` is used so a direct, matching denial is never turned away
    // for its act or its span (P2), and nothing is written either way (CQ 136).
    return ignored("target"); // A10
  }

  const real = codes.filter((c) => c !== NONE_CODE);
  const codesOr = (): string[] | "unresolved" => (real.length > 0 ? real : "unresolved");
  // Answering rule 5: an answer naming the item for an unresolved rule of a known subject stays pending, unless the
  // answer itself states the allergy (RX4), or is about someone else, who gets the normal table (CQ 146).
  if (answering && R !== null && R.code === "unresolved" && R.subjectId !== null && resolved?.id === R.subjectId && real.length > 0 && !RX4.test(normalizeForRegex(span.quote)) && ctx.speakerCertain) {
    return ok({ kind: "unsure", subject: R.subjectId, label: null, codes: real, question: null, proof });
  }
  if (polarity === "affirmed" && real.length > 0 && resolved !== null && ctx.speakerCertain && need === "none") {
    return ok({ kind: "affirm", subject: resolved.id, label: resolved.label, codes: real, proof }); // A11
  }
  if (!ctx.speakerCertain || resolved === null) {
    return ok({ kind: "unsure", subject: null, label: null, codes: codesOr(), question: real.length > 0 ? "whoHas" : "whatItem", proof }); // A12, A13
  }
  if (polarity === "affirmed" && need !== "none") {
    const question: QuestionKind = need === "subject" ? "whoHas" : need === "meaning" ? "isAllergy" : "whatItem";
    return ok({ kind: "unsure", subject: resolved.id, label: resolved.label, codes: codesOr(), question, proof }); // A14
  }
  if (real.length === 0) {
    if (answering && R !== null && R.code === "unresolved") return ok({ kind: "pendingKept", ruleId: R.id, question: "notListed" }); // A15, answering
    return ok({ kind: "unsure", subject: resolved.id, label: resolved.label, codes: "unresolved", question: "whatItem", proof }); // A15
  }
  return ok({ kind: "unsure", subject: resolved.id, label: resolved.label, codes: real, question: "isAllergy", proof }); // A16
}

// ---------------------------------------------------------------------------------------------
// Correction items (rows C1 to C8, R1)

/**
 * Predicates whose key doesn't depend on the value or the model's `scope` string (row C5b). `preference.schedule` is
 * left out: its scope holds the value's code, so its key depends on the value (CQ 155).
 */
const KEY_STABLE = new Set(["identity.name", "person.relation", "person.life", "employment.status", "employment.role", "preference.food", "preference.style", "handling", "care"]);


/** The words a value is said with, for "the turn names it" (rows C5c, C6). Null when it has none. */
export function valueWords(v: Value): string | null {
  if (v.kind === "text") return v.text;
  if (v.kind === "enum") return v.code.replace(/_/g, " ");
  return null;
}


/** The name a renamed entity has now (G33): its known label, else the word in the target's line that derives it. */
export function currentNameOf(entity: EID, line: string, ctx: Pick<ValidateContext, "known" | "hasher">): string | null {
  const known = ctx.known.entries.find((e) => e.id === entity && e.label.trim() !== "" && e.relation !== e.label);
  if (known !== undefined && mentionEid(known.kind, mentionName(known.label), ctx.hasher) === entity) return known.label;
  for (const t of line.match(/[\p{L}][\p{L}'-]*/gu) ?? []) {
    if (mentionEid("person", mentionName(t), ctx.hasher) === entity) return t;
  }
  return known?.label ?? null;
}

function correctionVerdict(item: Extract<FastItem, { kind: "correction" }>, index: number, need: Need, ctx: ValidateContext, budget: Budget): ItemVerdict {
  const ignored = (reason: "authority" | "span" | "act" | "target") => ({ kind: "ignored" as const, index, reason });
  const v = (verdict: CorrectionVerdict): ItemVerdict => ({ kind: "correction", index, v: verdict });
  const defer = (why: Extract<CorrectionVerdict, { kind: "defer" }>["why"]) => v({ kind: "defer", why });
  if (spanClass(item.span, ctx.evidence) !== "U") return ignored("authority"); // C1
  if (item.act !== "direct") return ignored("act"); // C2
  const span = verifyTurnSpan(item.span, ctx.evidence);
  if (span === null) return ignored("span"); // C3
  if (need !== "none") return defer("need"); // C4
  if (!ctx.speakerCertain) return defer("speaker");

  const targets: Memory[] = [];
  for (const id of item.targetIds) {
    const t = ctx.targets.get(id);
    if (t === undefined || protectedRow(t.memory)) return ignored("target"); // C5
    targets.push(t.memory);
  }
  const otherEntity = (m: Memory): EID | null => (typeof m.args.otherRef === "string" ? m.args.otherRef : m.subjectId !== "self" ? m.subjectId : null);
  const isRename = item.predicate === "identity.name" && targets.length === 1 && otherEntity(targets[0]!) !== null && targets[0]!.predicate !== "identity.name";
  if (!isRename && targets.some((t) => t.predicate !== item.predicate)) return ignored("target"); // C5
  if (new Set(targets.map((t) => t.key)).size !== 1) return ignored("target"); // C5a
  const target = targets[0]!;
  const args = { ...target.args, ...decodeArgs(item.args) };
  if (!KEY_STABLE.has(item.predicate)) return defer("keyUnstable"); // C5b
  // The new args would change the key: the one scope function says so (extraction's, through `scopeOf`).
  if (!isRename && scopeOf(item.predicate, args, item.replacementValue ?? target.value, ctx.hasher) !== target.scopeId) return defer("keyUnstable");

  const turnText = ctx.evidence.text;
  const line = ctx.targets.get(target.logicalId)!.line;
  const entity = isRename ? otherEntity(target)! : null;
  const currentWords = isRename ? currentNameOf(entity!, line, ctx) : valueWords(target.value);
  const named = currentWords !== null && findWholeWords(turnText, currentWords) !== null;
  const onlyOne = [...ctx.targets.values()].filter((t) => t.memory.predicate === target.predicate).length === 1;
  if (!named && !onlyOne) return defer("uncertainTarget"); // C5c

  const keys = new Set([...budget.keys, target.key, ...(isRename ? [`name:${entity}`] : [])]);
  const refs = budget.refs + targets.length + (isRename ? 2 : 1);
  if (keys.size > HANDLED_KEYS_MAX || refs > HANDLED_REFS_MAX) return defer("bounds"); // C5d
  const spend = (verdict: CorrectionVerdict): ItemVerdict => {
    budget.keys = keys;
    budget.refs = refs;
    return v(verdict);
  };

  if (isRename) {
    // R1: the old name by code, the new one from the span.
    if (currentWords === null) return defer("value");
    const said = item.replacementValue?.kind === "text" ? item.replacementValue.text : null;
    const at = said === null ? null : findWholeWords(span.quote, said);
    if (at === null) return defer("value");
    const to = span.quote.slice(at.start, at.end);
    if (mentionName(to) === mentionName(currentWords)) return v({ kind: "same", targets: [target.logicalId] });
    // Brief 043, finding 4: never against the owner's words ("her name is Mara, not Maya" never renames to Maya).
    if (renameRefuted(span.quote, currentWords, to)) return defer("value");
    return spend({ kind: "rename", target: target.logicalId, entity: entity!, from: currentWords, to });
  }
  if (item.replacementValue === null) {
    // Brief 043, finding 5: only on a negation tied to the target's value or its entity's name.
    const retractWords = [currentWords, ...(otherEntity(target) === null ? [] : [currentNameOf(otherEntity(target)!, line, ctx)])].filter((w): w is string => w !== null);
    if (item.args === null && named && retractionSaid(span.quote, retractWords)) return spend({ kind: "retract", targets: targets.map((t) => t.logicalId) }); // C6
    return defer("value"); // C6a
  }
  const value = item.replacementValue;
  if (sameValue(value, target.value) && canonicalJSON(args) === canonicalJSON(target.args)) return v({ kind: "same", targets: targets.map((t) => t.logicalId) }); // C6b
  // C7: the value fits the predicate, its words are in the span, entity refs are known.
  const fit = checkPredicateFit({ predicate: item.predicate, kind: target.kind, value, args }, "$") === null;
  const words = valueWords(value);
  const wordsOk = value.kind !== "text" || (words !== null && findWholeWords(span.quote, words) !== null);
  const entityOk = value.kind !== "entity" || value.ref === "self" || ctx.entities.some((e) => e.id === value.ref);
  if (fit && wordsOk && entityOk) return spend({ kind: "correct", targets: targets.map((t) => t.logicalId), value, args });
  return defer("value"); // C8
}

// ---------------------------------------------------------------------------------------------
// Transition items (rows T1 to T7)

/** Predicates each kind's truth order touches (design 3.3). */
export const TRUTH_ORDER: Record<Exclude<TransitionKind, "scheduledStart" | "expire">, readonly string[]> = {
  death: ["person.life", "care"],
  illness: ["person.life", "care"],
  recovery: ["person.life", "care"],
  breakup: ["person.relation"],
  reunion: ["person.relation"],
  move: ["place.residence"],
  jobChangeOwn: ["employment.role", "person.relation"],
  jobChangeOther: ["employment.role"],
};

/** Life changes whose `isSelf` subject needs `selfIsLifeSubject` (brief 043, finding 6); the owner's death is refused at T6. */
export const SELF_LIFE_KINDS: ReadonlySet<TransitionKind> = new Set(["illness", "recovery"]);

/** Past words the date resolver reads forward and doesn't resolve (CQ 134): the change is placed at the turn. */
const PAST_WORDS = /\b(yesterday|last (night|week|weekend|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|ago|earlier|just now|recently|this (morning|afternoon))\b/;

/**
 * Words that place a change said for the turn's own day before the turn (CQ 151). The resolver gives that day's
 * midnight for "today", "tonight", "this evening" or "later today", which are as often still to come, so those defer.
 */
const SAME_DAY_PAST = /\b(earlier|just now|ago|this morning)\b/;

/** When a stated change happened, or why it can't be placed now (row T6b). */
export function whenOf(whenSpoken: string | null, ev: { assertedAt: string; zone?: string | null }, worldNow: number): { ok: true; when: number } | { ok: false } {
  const said = msFromTs(ev.assertedAt);
  if (whenSpoken === null || whenSpoken.trim() === "" || !looksLikeTime(whenSpoken)) return { ok: true, when: Math.min(said, worldNow) };
  const zone = ev.zone ?? "UTC";
  const words = whenSpoken.normalize("NFKC").toLowerCase();
  const r = resolveSpoken(whenSpoken, said, zone);
  if (r !== null) {
    if (r.startMs > worldNow) return { ok: false };
    // A day-precision time on the turn's own day: only past-reading words place it, at the turn.
    if (r.precision === "day" && r.civilStart === civilDateAt(said, zone)) return SAME_DAY_PAST.test(words) ? { ok: true, when: Math.min(said, worldNow) } : { ok: false };
    return { ok: true, when: r.startMs };
  }
  return PAST_WORDS.test(words) ? { ok: true, when: Math.min(said, worldNow) } : { ok: false };
}

function transitionVerdict(item: Extract<FastItem, { kind: "transition" }>, index: number, need: Need, ctx: ValidateContext, budget: Budget): ItemVerdict {
  const ignored = (reason: "authority" | "span" | "target") => ({ kind: "ignored" as const, index, reason });
  const v = (verdict: TransitionVerdict): ItemVerdict => ({ kind: "transition", index, v: verdict });
  if (spanClass(item.span, ctx.evidence) !== "U") return ignored("authority"); // T1
  const span = verifyTurnSpan(item.span, ctx.evidence);
  if (span === null) return ignored("span"); // T2
  if (item.act !== "direct" || item.polarity !== "affirmed") return v({ kind: "careOnly" }); // T3
  if (need !== "none") return v({ kind: "defer", why: "need" }); // T4
  if (!ctx.speakerCertain) return v({ kind: "defer", why: "speaker" });
  if (item.transition === "scheduledStart" || item.transition === "expire") return v({ kind: "defer", why: "scheduled" }); // T5
  const kind = item.transition;
  // Brief 043, finding 1: the owner's words, not the model's ID or a cut-out span, choose who it happened to.
  const settled = (s: Subject) => ownerWordsSettle({ subject: s, span, evidence: ctx.evidence, known: ctx.known, entities: ctx.entities });
  if (!settled(item.subject) || (item.counterpart !== null && !settled(item.counterpart))) return v({ kind: "defer", why: "subject" });
  // Brief 043, finding 6: the owner ill or recovered only when their words make them its subject, naming no one else.
  const selfOnly = item.subject.isSelf && item.subject.entityId === null && item.subject.mention === null;
  if (selfOnly && SELF_LIFE_KINDS.has(kind) && !selfIsLifeSubject(span.quote, knownNameWords(ctx.known, ctx.entities))) return v({ kind: "defer", why: "subject" });
  // A transition's "my job" names the speaker; "my brother" doesn't (CQ 159).
  const subject = subjectOf(item.subject, span.quote, ctx, "person", "transition");
  const counterpartKind: EntityKind = kind === "move" ? "place" : kind === "jobChangeOwn" || kind === "jobChangeOther" ? "organization" : "person";
  const counterpart = item.counterpart === null ? null : subjectOf(item.counterpart, span.quote, ctx, counterpartKind, "transition");
  if (subject.kind === "ambiguous" || counterpart?.kind === "ambiguous") return v({ kind: "defer", why: "subject" }); // SU6
  const s = subject.kind === "resolved" ? subject.id : null;
  const c = counterpart !== null && counterpart.kind === "resolved" ? counterpart.id : null;
  if (
    s === null ||
    (kind === "death" && s === "self") ||
    ((kind === "breakup" || kind === "reunion") && c === null) ||
    (kind === "jobChangeOwn" && s !== "self") ||
    (kind === "jobChangeOther" && s === "self")
  ) {
    return ignored("target"); // T6
  }
  const rows = [...ctx.targets.values()].map((t) => t.memory).filter((m) => m.subjectId === s && TRUTH_ORDER[kind].includes(m.predicate));
  if ((kind === "jobChangeOwn" || kind === "jobChangeOther") && c === null && rows.filter((m) => m.predicate === "employment.role" && m.status === "active").length > 1) {
    return v({ kind: "defer", why: "employer" }); // T6a
  }
  const when = whenOf(item.whenSpoken, ctx.evidence, ctx.worldNow);
  if (!when.ok) return v({ kind: "defer", why: "time" }); // T6b
  const keys = new Set([...budget.keys, ...TRUTH_ORDER[kind].map((p) => `${s}:${p}`)]);
  const refs = budget.refs + 2 * (rows.length + 1);
  if (keys.size > HANDLED_KEYS_MAX || refs > HANDLED_REFS_MAX) return v({ kind: "defer", why: "bounds" }); // T6c
  budget.keys = keys;
  budget.refs = refs;
  return v({ kind: "change", transition: kind, subject: s, counterpart: c, when: when.when }); // T7
}

