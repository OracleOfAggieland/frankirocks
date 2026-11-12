/**
 * Open proposals (brief 012 G39): late hardRule results, written into `core/rules.proposals` without raising
 * `rulesRev`, and applied first by the next turn transaction and by `open`. Pure.
 *
 * A proposal installs its rules into absent slots only: an active rule is never replaced and a pending rule is never
 * relaxed, so applying one can only add a filter (fail closed). A slot is (subject, or anonymous, and code). At
 * `RULES_MAX - 1` rules the anonymous `unresolved` rule stands in for the rest, as the planner's bound does (G25).
 * `rulesRev` rises exactly when a rule was added; the proposals are cleared either way.
 */
import { type CoreRules, RULES_MAX, UNRESOLVED } from "@franki/core";

type AllergyRule = CoreRules["allergies"][number];

const slotOf = (r: AllergyRule) => `${r.anonymous ? "" : (r.subjectId ?? "")}|${r.code}`;

export function applyProposals(rules: CoreRules): { rules: CoreRules; changed: boolean } {
  const proposals = rules.proposals ?? [];
  if (proposals.length === 0) return { rules, changed: false };
  const list = [...rules.allergies];
  const slots = new Set(list.map(slotOf));
  let added = false;
  for (const p of proposals) {
    for (const r of p.install) {
      if (slots.has(slotOf(r))) continue;
      if (list.length >= RULES_MAX - 1) {
        const stand = { ...r, id: r.id, subjectId: null, anonymous: true, code: UNRESOLVED, state: "pending" as const };
        if (!slots.has(slotOf(stand)) && list.length < RULES_MAX) {
          list.push(stand);
          slots.add(slotOf(stand));
          added = true;
        }
        continue;
      }
      // A proposal never installs an active rule over nothing it can prove here: the backstop's are pending only.
      list.push(r);
      slots.add(slotOf(r));
      added = true;
    }
  }
  const next: CoreRules = { ...rules, allergies: list, proposals: [], rulesRev: added ? rules.rulesRev + 1 : rules.rulesRev };
  return { rules: next, changed: true };
}
