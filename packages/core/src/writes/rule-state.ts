/**
 * One rule slot (design 6.3): the only code that decides a slot's next state. A slot is keyed by (subject or
 * anonymous, code). Voice never relaxes an active rule; a pending rule leaves only by becoming active or through a
 * certain denial, or when a firmer rule on another slot answers it (`superseded`, 6.3's cross-slot reach); removal by
 * a trusted tap isn't built (the "What I know" sheet builds it). `superseded` reaches only a pending slot.
 */
import type { HardRuleOutcome, RuleEvent, RuleSlot } from "./types";

export function ruleTransition(s: RuleSlot, e: RuleEvent): { next: RuleSlot; outcome: HardRuleOutcome["kind"] } | { refused: "tapOnly" | "notPending" } {
  if (e.kind === "trustedTap") return { refused: "tapOnly" };
  if (e.kind === "superseded") return s.kind === "pending" ? { next: { kind: "absent" }, outcome: "pendingResolved" } : { refused: "notPending" };
  switch (s.kind) {
    case "absent":
      if (e.kind === "affirm") return { next: { kind: "active", rule: e.install }, outcome: "ruleWritten" };
      if (e.kind === "unsure") return { next: { kind: "pending", rule: e.install }, outcome: "pendingWritten" };
      return { next: s, outcome: "denialRecorded" };
    case "pending":
      if (e.kind === "affirm") return { next: { kind: "active", rule: e.install }, outcome: "pendingResolved" };
      if (e.kind === "unsure") return { next: s, outcome: "pendingKept" };
      return { next: { kind: "absent" }, outcome: "pendingResolved" };
    case "active":
      return { next: s, outcome: "ruleKept" };
  }
}
