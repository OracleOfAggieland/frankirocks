/**
 * The extraction worker's side of the allergy backstop (brief 012 G18, G39; task B8): reading allergy items out of
 * ExtractV1 output (flat or with a nested `claim`), and adding a proposal to `core/rules` without raising
 * `rulesRev`. Pure.
 *
 * At `PROPOSALS_MAX` open proposals a new one is merged into the newest: its rules join it, and past the install
 * bound the anonymous `unresolved` rule stands in for the rest, which still fails closed (G39).
 */
import { type BackstopItem, type BackstopProposal, type CoreRules, PROPOSALS_MAX, PROPOSAL_INSTALL_MAX, type Span } from "@franki/core";

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);

/** The allergy items among raw extraction items; anything malformed is left out (the plan already held it). */
export function backstopItems(raw: readonly unknown[]): BackstopItem[] {
  const out: BackstopItem[] = [];
  for (const r of raw) {
    if (!isRec(r)) continue;
    const claim = isRec(r.claim) ? r.claim : r;
    if (claim.predicate !== "allergy" || !isRec(claim.args) || typeof claim.args.allergenCode !== "string") continue;
    if (typeof r.act !== "string" || typeof r.subject !== "string" || !Array.isArray(r.spans)) continue;
    const spans = r.spans.filter((s): s is Span => isRec(s) && typeof s.eid === "string" && typeof s.start === "number" && typeof s.end === "number" && typeof s.quote === "string" && s.fieldPath === "text");
    if (spans.length !== r.spans.length) continue;
    out.push({ act: r.act, subject: r.subject, allergenCode: claim.args.allergenCode, spans });
  }
  return out;
}

const slot = (r: CoreRules["allergies"][number]) => `${r.anonymous ? "" : r.subjectId}|${r.code}`;

/** `core/rules` with the proposal added (one per Evidence: a second for the same Evidence replaces the first). */
export function withBackstop(rules: CoreRules, p: BackstopProposal | CoreRules["proposals"][number]): CoreRules {
  const others = rules.proposals.filter((x) => x.id !== p.id);
  if (others.length < PROPOSALS_MAX) return { ...rules, proposals: [...others, p] };
  const last = others.at(-1)!;
  const merged = [...last.install];
  for (const r of p.install) if (!merged.some((m) => slot(m) === slot(r))) merged.push(r);
  const anon = { ...p.install[0]!, id: `${p.id.slice(0, 32)}unresolvedx`.slice(0, 43), subjectId: null, anonymous: true, code: "unresolved", state: "pending" as const, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
  const install = merged.length <= PROPOSAL_INSTALL_MAX ? merged : [...merged.slice(0, PROPOSAL_INSTALL_MAX - 1), anon];
  return { ...rules, proposals: [...others.slice(0, -1), { ...last, install }] };
}
