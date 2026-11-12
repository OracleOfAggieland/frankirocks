/**
 * Install, pure and paged (spec §8 step 5; contracts §8 step 5; registry `forget` column). Writes, in order:
 *   1. root, semantic and provider blocks, and overlays (redact for removed ranges, withhold for a forgotten
 *      Memory's anchor: busy only, no moments, sensitivity never lower);
 *   2. the named Memories to `blocked`, and effects premised on them to `retracted`;
 *   3. sanitized Evidence revisions (new eid), the old Evidence to `blocked`, and `core/rules` with every affected
 *      rule re-anchored or pending.
 * A rule is never removed. Restraint that was not the target is not touched. With an uncommitted non-request turn
 * at the fence and no salvage in the floor, `noneConfirmed` is cleared (spec line 273).
 */
import type { Hasher } from "../ids";
import type { ID, SC, Span, TS } from "../schema/primitives";
import type { Block, CoreRules, Effect, Evidence, Memory, Overlay } from "../schema/records";
import type { Stamps } from "./fence";
import { NotBuilt } from "./not-built";
import type { RosterEntry } from "./reanchor";

/** Contracts §8: a page holds at most 50 documents. */
export const FORGET_PAGE_DOCS = 50;

export interface InstallInput {
  uid: string;
  opId: ID;
  /** The barrier's stamps (the epoch and policyRev the fence raised to). */
  stamps: Stamps;
  now: TS;
  /** Memories the resolve named exactly. */
  targets: readonly { id: ID; memory: Memory }[];
  /** Candidates held for an ask (scopePending): review-blocked, nothing removed. */
  review: readonly { id: ID; memory: Memory }[];
  /** Verified ranges the resolve named for removal. */
  remove: readonly Span[];
  /** Every Evidence a target root or a removed range names. */
  evidence: ReadonlyMap<ID, Evidence>;
  /** Effects in the store (all states). */
  effects: readonly { id: ID; effect: Effect }[];
  rules: CoreRules;
  roster: readonly RosterEntry[];
  /** A non-request turn of the Session was still uncommitted at the fence. */
  uncommittedAtFence: boolean;
  hasher: Hasher;
}

export type InstallWrite =
  | { order: 1; collection: "blocks"; id: ID; doc: Block }
  | { order: 1; collection: "overlays"; id: ID; doc: Overlay }
  | { order: 2; collection: "memories"; id: ID; doc: Memory }
  | { order: 2; collection: "effects"; id: ID; doc: Effect }
  | { order: 3; collection: "evidence"; id: ID; doc: Evidence }
  | { order: 3; collection: "core"; id: "rules"; doc: CoreRules };

export interface InstallPlan {
  writes: InstallWrite[];
  retainedRuleIds: ID[];
  pendingRuleIds: ID[];
  sanitizedEids: ID[];
  blockedKeys: ID[];
  touched: { collection: SC; count: number }[];
}

export function planInstall(_i: InstallInput): InstallPlan {
  throw new NotBuilt("planInstall");
}

/** Splits the writes into pages of at most `size` documents, never moving a write before an earlier order. */
export function installPages(_writes: readonly InstallWrite[], _size: number = FORGET_PAGE_DOCS): InstallWrite[][] {
  throw new NotBuilt("installPages");
}
