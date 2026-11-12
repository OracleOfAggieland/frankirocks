/**
 * The hard-rule route's decision rows (brief 042 item 6; question W-166; the list is brief 032's "Outcome"). One
 * ledger `rule` row per decision, as rule IDs, subject IDs, gazetteer codes and span offsets, never the owner's
 * words. Each row cites the Evidence the decision was made on (a proposal's own Evidence when it is installed) and
 * `rulesRev` after the write.
 *
 * The decisions are read from what changed between the rules before and after, plus the plan's outcome, notes and
 * ledger decisions, so a row names only a change that happened and every change has its row:
 *   1. `ruleWritten`: each new active rule.
 *   2. `pendingWritten`: each new pending rule, with its origin (`verdict`, `coverage`, the `fallback`, the bound's
 *      stand-in `bound`, or a `pasted` line's filter).
 *   3, 4. `pendingResolved` `by: "rule"` (naming the rule that answered it) or `by: "denial"`.
 *   5. `ruleKept` `why: "denied"`: a certain denial against an active rule, refused.
 *   6. `noneConfirmed`: a subject added or removed, or the list cleared.
 *   7. `proposalWritten` (the backstop's or a repair's) and `proposalInstalled` (on a later turn or an open).
 *   8. `denialRecorded`: each denial with the codes validation verified.
 *   9. `notAllergy`.
 *
 * Row IDs are `H("ruleRow", uid, rev of core/rules read, source, index)`. Every writer reads and updates `core/rules`
 * in the same transaction, so two commits never share a read rev, and a retried transaction writes the same IDs. No
 * read is added: the rows are creates, fetched with the transaction's other unread writes at commit.
 */
import {
  type CoreRules,
  type Hasher,
  type HardRulePlan,
  type ID,
  type ItemVerdict,
  type Ledger,
  type RuleRowPayload,
  type TS,
  Ledger as LedgerSchema,
  RULES_MAX,
  RULE_ROW_ITEMS_MAX,
  UNRESOLVED,
  gazetteerEntry,
  validate,
} from "@franki/core";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";

type Rule = CoreRules["allergies"][number];
type Proposal = CoreRules["proposals"][number];
type RuleItem = RuleRowPayload["rules"][number];
type Source = RuleRowPayload["source"];
type Origin = NonNullable<RuleItem["origin"]>;

/** A decision before it is stamped with its writer and split into rows. */
export interface RuleDecision {
  decision: RuleRowPayload["decision"];
  eid: ID;
  proposalId: ID | null;
  by: RuleRowPayload["by"];
  why: RuleRowPayload["why"];
  rules: RuleItem[];
  codes: string[];
  subjects: RuleRowPayload["subjects"];
  cleared: boolean;
}

const blank = (decision: RuleDecision["decision"], eid: ID): RuleDecision => ({ decision, eid, proposalId: null, by: null, why: null, rules: [], codes: [], subjects: [], cleared: false });

const item = (r: Rule, origin: Origin | null = null, answeredBy: ID | null = null): RuleItem => ({
  ruleId: r.id,
  subjectId: r.subjectId,
  code: r.code,
  state: r.state,
  anonymous: r.anonymous,
  proof: r.proof === null ? null : { eid: r.proof.eid as ID, start: r.proof.start, end: r.proof.end },
  origin,
  answeredBy,
});

const isFood = (code: string) => gazetteerEntry(code)?.domain === "food";
const subjectOf = (r: Rule) => (r.anonymous ? null : r.subjectId);

/**
 * The rule that answered a pending rule gone this turn, among the rules made active this turn: its own slot first,
 * then (for an anonymous rule) the same code for anyone, then (for an `unresolved` rule) a food rule for its subject,
 * or for anyone when it was anonymous. Null: a denial removed it.
 */
function answeredBy(p: Rule, gained: readonly Rule[]): ID | null {
  const s = subjectOf(p);
  const same = gained.find((a) => a.subjectId === s && a.code === p.code);
  if (same !== undefined) return same.id;
  if (p.anonymous) {
    const code = gained.find((a) => a.code === p.code);
    if (code !== undefined) return code.id;
  }
  if (p.code === UNRESOLVED) {
    const food = gained.find((a) => isFood(a.code) && (p.anonymous || a.subjectId === s));
    if (food !== undefined) return food.id;
  }
  return null;
}

/** Where a new pending rule came from (brief 032 W-166 row 2), read from the verdicts and the turn's other changes. */
function originOf(r: Rule, verdicts: readonly ItemVerdict[], before: CoreRules, otherChanges: number, pasted: boolean): Origin {
  if (pasted) return "pasted";
  if (!r.anonymous) return "verdict";
  const unsure = verdicts.flatMap((v) => (v.kind === "allergy" && v.v.kind === "unsure" && v.v.subject === null ? [v.v] : []));
  if (r.code !== UNRESOLVED) return unsure.some((u) => Array.isArray(u.codes) && u.codes.includes(r.code)) ? "verdict" : "coverage";
  if (unsure.some((u) => u.codes === UNRESOLVED)) return "verdict";
  // The fallback runs only when nothing else moved; the bound's stand-in only beside other moves or on a full list.
  return before.allergies.length >= RULES_MAX - 1 || otherChanges > 0 ? "bound" : "fallback";
}

/** The decisions of one hardRule plan, from the rules it started from to the rules it made. */
export function turnDecisions(
  before: CoreRules,
  after: CoreRules,
  plan: Pick<HardRulePlan, "outcome" | "note" | "ledger">,
  eid: ID,
  verdicts: readonly ItemVerdict[],
  opts: { pasted?: boolean } = {},
): RuleDecision[] {
  const beforeIds = new Map(before.allergies.map((r) => [r.id, r]));
  const afterIds = new Map(after.allergies.map((r) => [r.id, r]));
  const beforeActive = new Set(before.allergies.filter((r) => r.state === "active").map((r) => r.id));
  const gained = after.allergies.filter((r) => r.state === "active" && !beforeActive.has(r.id));
  const fresh = after.allergies.filter((r) => r.state === "pending" && !beforeIds.has(r.id));
  const gone = before.allergies.filter((r) => r.state === "pending" && !afterIds.has(r.id));
  const out: RuleDecision[] = [];

  if (gained.length > 0) out.push({ ...blank("ruleWritten", eid), rules: gained.map((r) => item(r)) });
  if (fresh.length > 0) {
    const others = gained.length + gone.length + fresh.length - 1;
    out.push({ ...blank("pendingWritten", eid), rules: fresh.map((r) => item(r, originOf(r, verdicts, before, others, opts.pasted === true))) });
  }
  const answered = gone.map((r) => ({ r, by: answeredBy(r, gained) }));
  const byRule = answered.filter((a) => a.by !== null);
  const byDenial = answered.filter((a) => a.by === null);
  if (byRule.length > 0) out.push({ ...blank("pendingResolved", eid), by: "rule", rules: byRule.map((a) => item(a.r, null, a.by)) });
  if (byDenial.length > 0) out.push({ ...blank("pendingResolved", eid), by: "denial", rules: byDenial.map((a) => item(a.r)) });

  if (plan.note.includes("ruleKept")) {
    // A denied active rule: the outcome names it when it is the turn's outcome; otherwise the denials' codes do.
    const deniedCodes = new Set(plan.ledger.filter((d) => d.outcome === "denialRecorded").flatMap((d) => d.codes));
    const ids =
      plan.outcome.kind === "ruleKept" && plan.outcome.why === "denied"
        ? plan.outcome.ruleIds
        : after.allergies.filter((r) => r.state === "active" && beforeActive.has(r.id) && deniedCodes.has(r.code)).map((r) => r.id);
    const kept = ids.flatMap((id) => {
      const r = afterIds.get(id);
      return r === undefined ? [] : [item(r)];
    });
    out.push({ ...blank("ruleKept", eid), why: "denied", rules: kept, codes: [...new Set(kept.map((k) => k.code))] });
  }

  const added = after.noneConfirmed.filter((s) => !before.noneConfirmed.includes(s));
  const removed = before.noneConfirmed.filter((s) => !after.noneConfirmed.includes(s));
  if (added.length > 0 || removed.length > 0) {
    out.push({
      ...blank("noneConfirmed", eid),
      subjects: [...added.map((subjectId) => ({ subjectId, change: "added" as const })), ...removed.map((subjectId) => ({ subjectId, change: "removed" as const }))],
      cleared: before.noneConfirmed.length > 0 && after.noneConfirmed.length === 0,
    });
  }

  for (const d of plan.ledger) {
    if (d.outcome === "denialRecorded") out.push({ ...blank("denialRecorded", d.eid as ID), codes: [...new Set(d.codes)] });
  }
  const na = plan.ledger.find((d) => d.outcome === "notAllergy");
  if (na !== undefined) out.push(blank("notAllergy", na.eid as ID));
  return out;
}

/** The proposals `applyProposals` consumed, each citing its own Evidence, with the rules it installed. */
export function installDecisions(before: CoreRules, after: CoreRules): RuleDecision[] {
  const proposals = before.proposals ?? [];
  if (proposals.length === 0) return [];
  const beforeIds = new Set(before.allergies.map((r) => r.id));
  const added = after.allergies.filter((r) => !beforeIds.has(r.id));
  const claimed = new Set<ID>();
  return proposals.map((p) => {
    const mine = added.filter((r) => !claimed.has(r.id) && p.install.some((i) => i.id === r.id));
    for (const r of mine) claimed.add(r.id);
    return { ...blank("proposalInstalled", p.eid as ID), proposalId: p.id as ID, rules: mine.map((r) => item(r)) };
  });
}

/** A proposal written into `core/rules.proposals` (the backstop's or a repair's), citing its Evidence. */
export function proposalDecision(p: Proposal): RuleDecision {
  return { ...blank("proposalWritten", p.eid as ID), proposalId: p.id as ID, rules: p.install.map((r) => item(r)) };
}

/** Splits a decision into rows of at most `RULE_ROW_ITEMS_MAX` rules, codes and subjects each. */
function parts(d: RuleDecision): Omit<RuleRowPayload, "source" | "sessionId" | "turnId" | "rulesRev">[] {
  const n = Math.max(1, Math.ceil(Math.max(d.rules.length, d.codes.length, d.subjects.length) / RULE_ROW_ITEMS_MAX));
  return Array.from({ length: n }, (_, i) => {
    const cut = <T>(xs: readonly T[]) => xs.slice(i * RULE_ROW_ITEMS_MAX, (i + 1) * RULE_ROW_ITEMS_MAX);
    return { decision: d.decision, eid: d.eid, proposalId: d.proposalId, by: d.by, why: d.why, rules: cut(d.rules), codes: cut(d.codes), subjects: cut(d.subjects), cleared: d.cleared, part: i };
  });
}

export interface RuleRowAt {
  uid: string;
  source: Source;
  sessionId: string | null;
  turnId: string | null;
  /** The `rev` of `core/rules` as this transaction read it. */
  rulesDocRev: number;
  /** `rulesRev` after the write. */
  rulesRev: number;
  now: TS;
  epoch: number;
  policyRev: number;
  hasher: Hasher;
}

export const ruleRowId = (hasher: Hasher, uid: string, rulesDocRev: number, source: Source, index: number): ID => hasher.id(["ruleRow", uid, String(rulesDocRev), source, String(index)]);

/**
 * Writes the rows inside the caller's transaction, which also updates `core/rules`. The count is bounded by the
 * rules list (`RULES_MAX`) and the proposals (`PROPOSALS_MAX`), so no cap drops a row. Throws on a row that fails
 * validation, as the Gate's writer does: that is a bug, and no rule change commits without its row.
 */
export function writeRuleRows(tx: Pick<Tx, "create">, at: RuleRowAt, decisions: readonly RuleDecision[]): ID[] {
  const rows = decisions.flatMap(parts);
  return rows.map((p, i) => {
    const payload: RuleRowPayload = { ...p, source: at.source, sessionId: (at.sessionId as ID | null) ?? null, turnId: (at.turnId as ID | null) ?? null, rulesRev: at.rulesRev };
    const entry: Extract<Ledger, { kind: "rule" }> = { ...cFields(at.uid, at.now, at.epoch, at.policyRev), kind: "rule", state: "complete", at: at.now, retainUntil: null, payload };
    if (!validate(LedgerSchema, entry).ok) throw new Error("rule row failed validation");
    const id = ruleRowId(at.hasher, at.uid, at.rulesDocRev, at.source, i);
    tx.create(paths.ledger(at.uid, id), entry);
    return id;
  });
}
