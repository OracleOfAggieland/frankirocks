/**
 * The Debug_Panel's rules section (brief 012 B11; brief 018 task B11): `core/rules` read with its defaults, and the
 * check of every proof span (rules and open proposals) against the Evidence it cites: the Evidence exists, its
 * revision is the rule's `proofRev`, and the quote is the text at `[start, end)`. Read-only.
 *
 * S2: a proof span over an S2 slice of its Evidence counts as revealed (the route logs the item ID, never the text).
 */
import { type CoreRules, type DebugItem, type DebugRuleProof, type Evidence, evidenceFieldText, withRulesDefaults } from "@franki/core";
import { paths } from "../store/paths";
import type { RouteContext } from "./runtime";

type Rule = CoreRules["allergies"][number];

function proofState(rule: Rule, ev: Evidence | null): DebugRuleProof["state"] {
  const p = rule.proof;
  if (p === null) return "none";
  if (ev === null) return "missingEvidence";
  if (rule.proofRev !== ev.rev) return "revMismatch";
  const text = evidenceFieldText(ev, p.fieldPath);
  return text !== null && text.slice(p.start, p.end) === p.quote ? "verified" : "spanQuoteMismatch";
}

export async function rulesItem(ctx: RouteContext): Promise<{ item: DebugItem | null; revealsS2: boolean }> {
  const { uid, deps } = ctx;
  const doc = await deps.store.get<CoreRules>(uid, paths.core(uid, "rules"));
  if (doc === null) return { item: null, revealsS2: false };
  const rules = withRulesDefaults(doc.data);
  const all: { rule: Rule; from: DebugRuleProof["from"] }[] = [
    ...rules.allergies.map((rule) => ({ rule, from: "rule" as const })),
    ...rules.proposals.flatMap((p) => p.install.map((rule) => ({ rule, from: "proposal" as const }))),
  ];
  const eids = [...new Set(all.flatMap(({ rule }) => (rule.proof === null ? [] : [rule.proof.eid])))];
  const docs = await Promise.all(eids.map((eid) => deps.store.get<Evidence>(uid, paths.evidence(uid, eid)).catch(() => null)));
  const byEid = new Map(eids.map((eid, i) => [eid, docs[i]?.data ?? null]));
  let revealsS2 = false;
  const proofs = all.map(({ rule, from }) => {
    const ev = rule.proof === null ? null : (byEid.get(rule.proof.eid) ?? null);
    const p = rule.proof;
    if (p !== null && ev !== null && ev.fieldSlices.some((s) => s.sens === "S2" && s.start !== null && s.end !== null && s.start < p.end && p.start < s.end)) revealsS2 = true;
    return { ruleId: rule.id, from, state: proofState(rule, ev) };
  });
  return { item: { kind: "rules", id: "rules", record: rules, proofs }, revealsS2 };
}
