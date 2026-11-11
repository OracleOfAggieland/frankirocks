/**
 * The hardRule planner (design 2.5, 2.6, 6.2): slots, cross-slot reach, coverage, the fallback and the bounds.
 * Pure; returns the next `core/rules` and writes nothing.
 *
 * 1. Each allergy verdict moves its slots through `ruleTransition` (6.3). A proof must lie in a U slice of this turn
 *    (or be the asked rule's own proof with the answer on a U slice of this turn, answering rule 4); any other verdict
 *    writes nothing (P1). A rule made from an answer cites both Evidences in `dependsOn` (CQ 147). A newly active
 *    rule also supersedes, only where it answers them (CQ 132, narrowed by CQ 144): the anonymous pending rule with
 *    its code; for a food code, its subject's `unresolved` rule and an asked anonymous `unresolved` rule. Every
 *    other pending rule stays, so a pending rule leaves only for its own slot.
 * 2. Coverage: every alias found in the U parts of the cue sentences whose code no verdict carries becomes an
 *    anonymous pending rule (fail closed; an ignored item carries nothing). Only a plain mention a subject was
 *    resolved from is left out of the scan.
 * 3. The fallback: when nothing was written, kept, resolved or recorded, and the `notAllergy` double check (G3)
 *    doesn't pass, the anonymous `unresolved` rule, over the cue sentences' U parts with no mention cut. Never on a
 *    turn triggered only by the asked question.
 * 4. Bounds: past `RULE_SLOTS_PER_TURN` slot changes, or at `RULES_MAX - 1` rules, the anonymous `unresolved` rule
 *    stands in for the rest (G25).
 * `rulesRev` rises exactly when `allergies` or `noneConfirmed` changed. The outcome is read from what changed.
 */
import { canonicalJSON } from "../ids";
import type { EID, ID, Span } from "../schema/primitives";
import type { CoreRules } from "../schema/records";
import { GAZETTEER_VERSION, gazetteerEntry, scanAliases } from "./gazetteer";
import { type Range, cueSentenceRanges, cueSentenceUParts, cueSentences, cueSpan, notAllergyByCode } from "./not-allergy";
import { ruleTransition } from "./rule-state";
import { spanClass, uParts, verifyTurnSpan } from "./spans";
import type { AllergyVerdict, HardRuleOutcome, HardRulePlan, HardRuleTurn, ItemVerdict, LedgerDecision, QuestionKind, RouteNoteKind, RuleEvent, RuleSlot } from "./types";

export const RULE_SLOTS_PER_TURN = 32;
export const RULES_MAX = 256;
export const UNRESOLVED = "unresolved";

type AllergyRule = CoreRules["allergies"][number];

/** One question per turn, in this order (6.2). */
const QUESTION_ORDER: readonly QuestionKind[] = ["whatItem", "whoHas", "isAllergy", "notListed"];
/** Which reason a `ruleKept` outcome gives when several slots were kept: a denial first, the one that cuts (section 4). */
const KEPT_ORDER = ["denied", "weaker", "duplicate"] as const;
type KeptWhy = (typeof KEPT_ORDER)[number];

/** An `unresolved` rule filters all food, so only a food allergy answers it (CQ 144). */
const isFood = (code: string) => gazetteerEntry(code)?.domain === "food";

interface Proven {
  proof: Span;
  proofRev: number | null;
  rootKeys: ID[];
  dependsOn: string[];
}

/** Whether a verdict names a resolved subject, so its item's plain mention may be left out of coverage. */
const hasSubject = (a: AllergyVerdict): boolean => a.kind === "affirm" || (a.kind === "unsure" && a.subject !== null) || (a.kind === "deny" && "subject" in a);

export function planHardRule(rules: CoreRules, verdicts: readonly ItemVerdict[], turn: HardRuleTurn): HardRulePlan {
  const ev = turn.evidence;
  const H = turn.hasher;
  const list: AllergyRule[] = rules.allergies.map((r) => ({ ...r }));
  let none: EID[] = [...rules.noneConfirmed];
  const ledger: LedgerDecision[] = [];
  const keptRules = new Map<ID, KeptWhy>();
  const keep = (id: ID, why: KeptWhy) => {
    const had = keptRules.get(id);
    if (had === undefined || KEPT_ORDER.indexOf(why) < KEPT_ORDER.indexOf(had)) keptRules.set(id, why);
  };
  const keptPending = new Set<ID>();
  const questions = new Set<QuestionKind>();
  const carried = new Set<string>();
  const globalDenials: EID[] = [];
  let denied = false;
  let changes = 0;
  const R = turn.answering?.rule ?? null;

  // -------------------------------------------------------------------------------------------
  // Proofs and rules

  /**
   * The proof as a rule may hold it: on a U slice of this turn, or the asked rule's own proof when the item at
   * `index` answers it on a U slice of this turn. Such a rule depends on both Evidences; its root keys stay the proof
   * Evidence's (CQ 147).
   */
  const proven = (p: Span | null, index: number | null = null): Proven | null => {
    if (p === null) return null;
    if (p.eid === ev.eid) {
      const at = verifyTurnSpan(p, ev);
      if (at === null || spanClass(at, ev) !== "U") return null;
      const rootKeys = ev.slices.flatMap((s, i) => (s.start !== null && s.end !== null && s.start < at.end && at.start < s.end && ev.rootKeys[i] !== undefined ? [ev.rootKeys[i]!] : [])).slice(0, 16);
      const askedDeps = R?.proof !== null && R?.proof !== undefined ? R.dependsOn : [];
      return { proof: at, proofRev: ev.rev, rootKeys, dependsOn: [...new Set([`e:${ev.eid}`, ...askedDeps])].slice(0, 32) };
    }
    if (R === null || R.proof === null || canonicalJSON(R.proof) !== canonicalJSON(p)) return null;
    const item = index === null ? undefined : turn.out?.items[index];
    const answer = item === undefined ? null : verifyTurnSpan(item.span, ev);
    if (answer === null || spanClass(answer, ev) !== "U") return null;
    return { proof: R.proof, proofRev: R.proofRev, rootKeys: R.rootKeys, dependsOn: [...new Set([`e:${ev.eid}`, ...R.dependsOn])].slice(0, 32) };
  };
  const activeRule = (subject: EID, code: string, p: Proven): AllergyRule => ({
    id: H.id(["allergy", subject, code]),
    subjectId: subject,
    code,
    state: "active",
    anonymous: false,
    proof: p.proof,
    proofRev: p.proofRev,
    rootKeys: p.rootKeys,
    dependsOn: p.dependsOn,
  });
  // Contracts §1's anonymous pending shape when there is no proof (CQ 99).
  const pendingRule = (subject: EID | null, code: string, p: Proven | null): AllergyRule => ({
    id: H.id(["allergyPending", subject ?? "anyone", code, ev.eid]),
    subjectId: subject,
    code,
    state: "pending",
    anonymous: subject === null,
    proof: p?.proof ?? null,
    proofRev: p?.proofRev ?? null,
    rootKeys: p?.rootKeys ?? [],
    dependsOn: p?.dependsOn ?? [],
  });

  // -------------------------------------------------------------------------------------------
  // Slots

  const slotIndex = (subject: EID | null, code: string): number => {
    const of = (r: AllergyRule) => (r.anonymous ? null : r.subjectId) === subject && r.code === code;
    const active = list.findIndex((r) => of(r) && r.state === "active");
    return active >= 0 ? active : list.findIndex(of);
  };
  const slotAt = (i: number): RuleSlot => (i < 0 ? { kind: "absent" } : list[i]!.state === "active" ? { kind: "active", rule: list[i]! } : { kind: "pending", rule: list[i]! });
  const pendingWritten = (subject: EID | null) => {
    // 2.6: a pending rule for S removes S; an anonymous one clears the list.
    none = subject === null ? [] : none.filter((s) => s !== subject);
  };
  /** G25: the anonymous `unresolved` rule stands in when a bound is reached; it is the one slot exempt from them. */
  const standIn = () => {
    const i = slotIndex(null, UNRESOLVED);
    const r = ruleTransition(slotAt(i), { kind: "unsure", proof: null, install: pendingRule(null, UNRESOLVED, null) });
    if ("refused" in r) return;
    if (r.outcome === "pendingKept" && i >= 0) keptPending.add(list[i]!.id);
    else if (r.outcome === "pendingWritten" && r.next.kind === "pending" && list.length < RULES_MAX) {
      list.push(r.next.rule);
      pendingWritten(null);
      questions.add("whatItem");
    }
  };
  /** A pending rule that another slot's new active rule answers (6.3's cross-slot reach), through `ruleTransition`. */
  const supersede = (i: number) => {
    if (i < 0) return;
    const r = ruleTransition(slotAt(i), { kind: "superseded" });
    if (!("refused" in r) && r.next.kind === "absent") list.splice(i, 1);
  };

  /** Moves one slot; returns the slot's outcome, or null when the event was refused or a bound stood in. */
  const apply = (subject: EID | null, code: string, e: RuleEvent): HardRuleOutcome["kind"] | null => {
    const i = slotIndex(subject, code);
    const from = slotAt(i);
    const r = ruleTransition(from, e);
    if ("refused" in r) return null;
    const grows = from.kind === "absent" && r.next.kind !== "absent";
    const moves = grows || (from.kind === "pending" && r.next.kind === "active");
    const isStandIn = subject === null && code === UNRESOLVED;
    if (grows && list.length >= RULES_MAX) {
      // A full list (a document filled another way): nothing grows past the schema's bound.
      standIn();
      return null;
    }
    if (moves && (changes + 1 > RULE_SLOTS_PER_TURN || (grows && !isStandIn && list.length >= RULES_MAX - 1))) {
      standIn();
      return null;
    }
    if (moves) changes++;
    if (r.next.kind === "absent") {
      if (i >= 0) list.splice(i, 1);
    } else if (r.next !== from) {
      if (i >= 0) list[i] = r.next.rule;
      else list.push(r.next.rule);
    }
    if (r.outcome === "pendingWritten") pendingWritten(subject);
    if (r.outcome === "pendingKept" && i >= 0) keptPending.add(list[i]!.id);
    return r.outcome;
  };

  // -------------------------------------------------------------------------------------------
  // 1. The verdicts

  let allergyVerdicts = 0;
  for (const v of verdicts) {
    if (v.kind === "ignored") {
      // Row A6: a denial from an uncertain speaker is a ledger decision only, with the codes validation verified (CQ 148).
      if (v.reason === "speaker") {
        for (const c of v.codes) carried.add(c);
        ledger.push({ eid: ev.eid, outcome: "denialRecorded", codes: v.codes });
        denied = true;
      }
      continue;
    }
    if (v.kind !== "allergy") continue;
    allergyVerdicts++;
    const a = v.v;
    switch (a.kind) {
      case "affirm": {
        const p = proven(a.proof, v.index);
        if (p === null) break;
        for (const code of a.codes) {
          carried.add(code);
          const before = slotAt(slotIndex(a.subject, code)).kind;
          const out = apply(a.subject, code, { kind: "affirm", proof: p.proof, deps: p.dependsOn, install: activeRule(a.subject, code, p) });
          if (out === "ruleKept") keep(list[slotIndex(a.subject, code)]!.id, "duplicate");
          if (before !== "active" && (out === "ruleWritten" || out === "pendingResolved")) {
            // Cross-slot reach (6.3, CQ 144): only the pending rules this rule answers.
            supersede(slotIndex(null, code));
            if (isFood(code)) {
              supersede(slotIndex(a.subject, UNRESOLVED));
              if (R !== null && R.anonymous && R.code === UNRESOLVED) supersede(list.findIndex((r) => r.id === R.id));
            }
          }
        }
        break;
      }
      case "unsure": {
        const p = proven(a.proof, v.index);
        if (a.proof !== null && p === null) break;
        const codes = a.codes === UNRESOLVED ? [UNRESOLVED] : a.codes;
        for (const code of codes) {
          if (code !== UNRESOLVED) carried.add(code);
          const out = apply(a.subject, code, { kind: "unsure", proof: p?.proof ?? null, install: pendingRule(a.subject, code, p) });
          if (out === "pendingWritten" && a.question !== null) questions.add(a.question);
          if (out === "ruleKept") keep(list[slotIndex(a.subject, code)]!.id, "weaker");
        }
        break;
      }
      case "deny": {
        if (proven(a.proof) === null || !turn.speakerCertain) break;
        denied = true;
        if ("answers" in a) {
          const target = list.find((r) => r.id === a.answers && r.state === "pending");
          if (target !== undefined) {
            carried.add(target.code);
            apply(null, target.code, { kind: "deny" });
          }
          ledger.push({ eid: ev.eid, outcome: "denialRecorded", codes: target === undefined || target.code === UNRESOLVED ? [] : [target.code] });
          break;
        }
        const S = a.subject;
        const named = a.scope === "global" ? list.filter((r) => !r.anonymous && r.subjectId === S).map((r) => r.code) : a.codes;
        for (const code of new Set(named)) {
          if (a.scope === "specific") carried.add(code);
          const out = apply(S, code, { kind: "deny" });
          if (out === "ruleKept") keep(list[slotIndex(S, code)]!.id, "denied");
        }
        if (a.scope === "global") globalDenials.push(S);
        // The decision is about every code it reached: a global denial's are the subject's rules.
        ledger.push({ eid: ev.eid, outcome: "denialRecorded", codes: [...new Set(named)].filter((c) => c !== UNRESOLVED) });
        break;
      }
      case "pendingKept": {
        if (a.ruleId !== null && list.some((r) => r.id === a.ruleId)) keptPending.add(a.ruleId);
        if (a.question !== null) questions.add(a.question);
        break;
      }
    }
  }

  // 3. A turn triggered only by the asked question, with no allergy verdict, changes nothing.
  const askedOnly = !turn.trigger.regex && !turn.trigger.candidate;
  if (askedOnly && allergyVerdicts === 0) {
    const kept = R !== null && rules.allergies.some((r) => r.id === R.id) ? [R.id] : [];
    return { rules, outcome: { kind: "pendingKept", ruleIds: kept }, note: [], ledger };
  }

  // 2. Coverage over the U parts of the cue sentences. A plain mention is left out only for an item whose subject was
  // resolved from it ("my dog" in "my dog can't have chicken"); any other mention is scanned (CQ 150).
  const resolvedFrom = new Set(verdicts.flatMap((v) => (v.kind === "allergy" && hasSubject(v.v) ? [v.index] : [])));
  const cues = cueSentences(ev, turn.out, turn.answering !== null, resolvedFrom);
  for (const r of cues) {
    for (const hit of scanAliases(ev.text, r.start, r.end)) {
      if (carried.has(hit.code)) continue;
      carried.add(hit.code);
      const p = proven({ eid: ev.eid, fieldPath: "text", start: hit.start, end: hit.end, quote: ev.text.slice(hit.start, hit.end) });
      const out = apply(null, hit.code, { kind: "unsure", proof: p?.proof ?? null, install: pendingRule(null, hit.code, p) });
      if (out === "pendingWritten") questions.add("whoHas");
    }
  }

  // G3: the model's half and the code's half of the notAllergy check.
  const out = turn.out;
  const modelSays = out !== null && turn.answering === null && out.need === "none" && out.items.every((it) => it.kind !== "allergy" || it.act === "hypothetical");
  const notAllergy = modelSays && notAllergyByCode(ev);

  // 3. The fallback.
  const somethingDone = () => changed() || keptRules.size > 0 || keptPending.size > 0 || denied;
  const changed = () => canonicalJSON(list) !== canonicalJSON(rules.allergies) || canonicalJSON(none) !== canonicalJSON(rules.noneConfirmed);
  if (!askedOnly && !somethingDone() && !notAllergy) {
    // The cue sentences' U parts with no mention cut, so a U cue sentence never ends with nothing (CQ 150).
    const whole = cueSentenceRanges(ev, out, turn.answering !== null);
    const scope: Range[] = whole.length > 0 ? cueSentenceUParts(ev, out, turn.answering !== null) : uParts(ev.slices, 0, ev.text.length);
    if (scope.length > 0) {
      const p = proven(cueSpan(ev, scope));
      const o = apply(null, UNRESOLVED, { kind: "unsure", proof: p?.proof ?? null, install: pendingRule(null, UNRESOLVED, p) });
      if (o === "pendingWritten") questions.add("whatItem");
    }
  }

  // 2.6: a global denial adds its subject when nothing is pending for anyone and the subject has no rule.
  for (const S of globalDenials) {
    const clear = !list.some((r) => !r.anonymous && r.subjectId === S) && !list.some((r) => r.anonymous && r.state === "pending");
    if (clear && !none.includes(S)) none = [...none, S];
  }

  // -------------------------------------------------------------------------------------------
  // The outcome, read from what changed

  const didChange = changed();
  const beforeActive = new Set(rules.allergies.filter((r) => r.state === "active").map((r) => r.id));
  const afterIds = new Set(list.map((r) => r.id));
  const resolved = rules.allergies.filter((r) => r.state === "pending" && !afterIds.has(r.id)).map((r) => r.id);
  const gained = list.filter((r) => r.state === "active" && !beforeActive.has(r.id)).map((r) => r.id);
  const beforeIds = new Set(rules.allergies.map((r) => r.id));
  const newPending = list.filter((r) => r.state === "pending" && !beforeIds.has(r.id)).map((r) => r.id);
  const noneGained = none.some((s) => !rules.noneConfirmed.includes(s));
  const kept = [...keptRules].filter(([id]) => afterIds.has(id));
  const keptP = [...keptPending].filter((id) => afterIds.has(id));
  const question = QUESTION_ORDER.find((q) => questions.has(q)) ?? null;

  let outcome: HardRuleOutcome;
  if (resolved.length > 0) outcome = { kind: "pendingResolved", ruleIds: [...resolved, ...gained], by: gained.length > 0 ? "rule" : "denial" };
  else if (gained.length > 0) outcome = { kind: "ruleWritten", ruleIds: gained };
  else if (newPending.length > 0) outcome = { kind: "pendingWritten", ruleIds: newPending, question };
  else if (kept.length > 0) outcome = { kind: "ruleKept", ruleIds: kept.map(([id]) => id), why: KEPT_ORDER.find((w) => kept.some(([, k]) => k === w))! };
  else if (keptP.length > 0) outcome = { kind: "pendingKept", ruleIds: keptP };
  else if (denied) outcome = { kind: "denialRecorded", wrote: noneGained ? "noneConfirmed" : "ledgerOnly" };
  else if (notAllergy) outcome = { kind: "notAllergy" };
  // Nothing moved: an asked-only turn whose answer reached no slot, or a turn with no U text to write from (P1).
  else outcome = { kind: "pendingKept", ruleIds: R !== null && afterIds.has(R.id) ? [R.id] : [] };
  if (outcome.kind === "notAllergy" || (!didChange && outcome.kind === "denialRecorded" && !ledger.some((d) => d.eid === ev.eid))) {
    // notAllergy and a ledger-only denial are recorded in the ledger (P4: a decision cites the turn).
    ledger.push({ eid: ev.eid, outcome: outcome.kind, codes: [] });
  }

  // Notes (2.7): pointers only, one question at most.
  const note: RouteNoteKind[] = [];
  if (gained.length > 0) note.push("ruleSaved");
  if (kept.some(([, why]) => why !== "denied")) note.push("ruleAlready");
  if (kept.some(([, why]) => why === "denied")) note.push("ruleKept");
  if (noneGained) note.push("noneSaved");
  const asked = question === null ? null : question === "notListed" ? keptP.length > 0 || newPending.length > 0 : newPending.length > 0;
  if (question !== null && asked) note.push(`ask.${question}` as RouteNoteKind);

  const next: CoreRules = didChange ? { ...rules, allergies: list, noneConfirmed: none, rulesRev: rules.rulesRev + 1, gazetteerVersion: GAZETTEER_VERSION } : rules;
  return { rules: next, outcome, note, ledger };
}
