/**
 * The hardRule planner (design 2.5, 2.6, 6.2): slots, cross-slot reach, coverage, the fallback and the bounds.
 * Pure; returns the next `core/rules` and writes nothing.
 *
 * 1. Each allergy verdict moves its slots through `ruleTransition` (6.3). A proof must lie in a U slice of this turn
 *    (or be the asked rule's own proof, answering rule 4); any other verdict writes nothing (P1). A newly active rule
 *    also resolves the anonymous pending rule with its code, its subject's `unresolved` rule and the asked rule
 *    (CQ 132: only when the slot became active, so a pending rule leaves only when a rule is gained).
 * 2. Coverage: every alias found in the U parts of the cue sentences whose code no verdict carries becomes an
 *    anonymous pending rule (fail closed; an ignored item carries nothing).
 * 3. The fallback: when nothing was written, kept, resolved or recorded, and the `notAllergy` double check (G3)
 *    doesn't pass, the anonymous `unresolved` rule. Never on a turn triggered only by the asked question.
 * 4. Bounds: past `RULE_SLOTS_PER_TURN` slot changes, or at `RULES_MAX - 1` rules, the anonymous `unresolved` rule
 *    stands in for the rest (G25).
 * `rulesRev` rises exactly when `allergies` or `noneConfirmed` changed. The outcome is read from what changed.
 */
import { canonicalJSON } from "../ids";
import type { EID, ID, Span } from "../schema/primitives";
import type { CoreRules } from "../schema/records";
import { GAZETTEER_VERSION, NONE_CODE, lookupAllergen, scanAliases } from "./gazetteer";
import { type Range, cueSentenceRanges, cueSentences, cueSpan, notAllergyByCode } from "./not-allergy";
import { ruleTransition } from "./rule-state";
import { spanClass, uParts, verifyTurnSpan } from "./spans";
import type { HardRuleOutcome, HardRulePlan, HardRuleTurn, ItemVerdict, LedgerDecision, QuestionKind, RouteNoteKind, RuleEvent, RuleSlot } from "./types";

export const RULE_SLOTS_PER_TURN = 32;
export const RULES_MAX = 256;
export const UNRESOLVED = "unresolved";

type AllergyRule = CoreRules["allergies"][number];

/** One question per turn, in this order (6.2). */
const QUESTION_ORDER: readonly QuestionKind[] = ["whatItem", "whoHas", "isAllergy", "notListed"];

interface Proven {
  proof: Span;
  proofRev: number | null;
  rootKeys: ID[];
  dependsOn: string[];
}

export function planHardRule(rules: CoreRules, verdicts: readonly ItemVerdict[], turn: HardRuleTurn): HardRulePlan {
  const ev = turn.evidence;
  const H = turn.hasher;
  const list: AllergyRule[] = rules.allergies.map((r) => ({ ...r }));
  let none: EID[] = [...rules.noneConfirmed];
  const ledger: LedgerDecision[] = [];
  const keptRules = new Map<ID, "duplicate" | "weaker" | "denied">();
  const keptPending = new Set<ID>();
  const questions = new Set<QuestionKind>();
  const carried = new Set<string>();
  const globalDenials: EID[] = [];
  let denied = false;
  let changes = 0;
  const R = turn.answering?.rule ?? null;

  // -------------------------------------------------------------------------------------------
  // Proofs and rules

  /** The proof as a rule may hold it: on a U slice of this turn, or the asked rule's own proof. */
  const proven = (p: Span | null): Proven | null => {
    if (p === null) return null;
    if (p.eid === ev.eid) {
      const at = verifyTurnSpan(p, ev);
      if (at === null || spanClass(at, ev) !== "U") return null;
      const rootKeys = ev.slices.flatMap((s, i) => (s.start !== null && s.end !== null && s.start < at.end && at.start < s.end && ev.rootKeys[i] !== undefined ? [ev.rootKeys[i]!] : [])).slice(0, 16);
      const askedDeps = R?.proof !== null && R?.proof !== undefined ? R.dependsOn : [];
      return { proof: at, proofRev: ev.rev, rootKeys, dependsOn: [...new Set([`e:${ev.eid}`, ...askedDeps])].slice(0, 32) };
    }
    if (R !== null && R.proof !== null && canonicalJSON(R.proof) === canonicalJSON(p)) return { proof: R.proof, proofRev: R.proofRev, rootKeys: R.rootKeys, dependsOn: R.dependsOn };
    return null;
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
  const removeId = (id: ID) => {
    const i = list.findIndex((r) => r.id === id && r.state === "pending");
    if (i >= 0) list.splice(i, 1);
  };
  const pendingWritten = (subject: EID | null) => {
    // 2.6: a pending rule for S removes S; an anonymous one clears the list.
    none = subject === null ? [] : none.filter((s) => s !== subject);
  };
  /** G25: the anonymous `unresolved` rule stands in when a bound is reached. */
  const standIn = () => {
    const i = slotIndex(null, UNRESOLVED);
    if (i >= 0) keptPending.add(list[i]!.id);
    else if (list.length < RULES_MAX) {
      list.push(pendingRule(null, UNRESOLVED, null));
      pendingWritten(null);
      questions.add("whatItem");
    }
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
      // Row A6: a denial from an uncertain speaker is a ledger decision only, and carries its codes.
      const item = turn.out?.items[v.index];
      if (v.reason === "speaker" && item?.kind === "allergy") {
        const codes = lookupAllergen(item.item).filter((c) => c !== NONE_CODE);
        for (const c of codes) carried.add(c);
        ledger.push({ eid: ev.eid, outcome: "denialRecorded", codes });
        denied = true;
      }
      continue;
    }
    if (v.kind !== "allergy") continue;
    allergyVerdicts++;
    const a = v.v;
    switch (a.kind) {
      case "affirm": {
        const p = proven(a.proof);
        if (p === null) break;
        for (const code of a.codes) {
          carried.add(code);
          const before = slotAt(slotIndex(a.subject, code)).kind;
          const out = apply(a.subject, code, { kind: "affirm", proof: p.proof, deps: p.dependsOn, install: activeRule(a.subject, code, p) });
          if (out === "ruleKept") keptRules.set(list[slotIndex(a.subject, code)]!.id, "duplicate");
          if (before !== "active" && (out === "ruleWritten" || out === "pendingResolved")) {
            // Cross-slot reach (6.3).
            const anon = slotIndex(null, code);
            if (anon >= 0 && list[anon]!.state === "pending") list.splice(anon, 1);
            const unresolved = slotIndex(a.subject, UNRESOLVED);
            if (unresolved >= 0 && list[unresolved]!.state === "pending") list.splice(unresolved, 1);
            if (R !== null) removeId(R.id);
          }
        }
        break;
      }
      case "unsure": {
        const p = proven(a.proof);
        if (a.proof !== null && p === null) break;
        const codes = a.codes === UNRESOLVED ? [UNRESOLVED] : a.codes;
        for (const code of codes) {
          if (code !== UNRESOLVED) carried.add(code);
          const out = apply(a.subject, code, { kind: "unsure", proof: p?.proof ?? null, install: pendingRule(a.subject, code, p) });
          if (out === "pendingWritten" && a.question !== null) questions.add(a.question);
          if (out === "ruleKept") keptRules.set(list[slotIndex(a.subject, code)]!.id, "weaker");
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
          if (out === "ruleKept") keptRules.set(list[slotIndex(S, code)]!.id, "denied");
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

  // 2. Coverage over the U parts of the cue sentences.
  const cues = cueSentences(ev, turn.out, turn.answering !== null);
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
  const notAllergy = modelSays && notAllergyByCode(ev, out);

  // 3. The fallback.
  const somethingDone = () => changed() || keptRules.size > 0 || keptPending.size > 0 || denied;
  const changed = () => canonicalJSON(list) !== canonicalJSON(rules.allergies) || canonicalJSON(none) !== canonicalJSON(rules.noneConfirmed);
  if (!askedOnly && !somethingDone() && !notAllergy) {
    const whole = cueSentenceRanges(ev, out, turn.answering !== null);
    const scope: Range[] = whole.length > 0 ? cues : uParts(ev.slices, 0, ev.text.length);
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
  else if (kept.length > 0) outcome = { kind: "ruleKept", ruleIds: kept.map(([id]) => id), why: kept[0]![1] };
  else if (keptP.length > 0) outcome = { kind: "pendingKept", ruleIds: keptP };
  else if (denied) outcome = { kind: "denialRecorded", wrote: noneGained ? "noneConfirmed" : "ledgerOnly" };
  else if (notAllergy) outcome = { kind: "notAllergy" };
  else outcome = { kind: "pendingKept", ruleIds: [] };
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
