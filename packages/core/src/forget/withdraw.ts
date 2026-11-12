/**
 * What withdrawal keeps, pure (spec §8 lines 275 to 279; contracts §4 registry note, §8 step 6). Withdrawing a
 * row that was not the target retracts the effects it premised, and every exclude, quiet or care hold among them
 * survives as a content-free `withdrawnHold` on the same target and scope, with no premises, roots or
 * dependencies. A `wrong` Memory stays `wrong` (it is a negative). Render sensitivity never falls.
 *
 * Closure (spec §8 step 6) decides which rows withdraw; it is not built in this part, so nothing here calls this
 * function outside tests.
 */
import type { Hasher } from "../ids";
import { maxSens } from "../lexicon";
import type { ID, Ref, TS } from "../schema/primitives";
import { type Effect, HOLD_KINDS, type Memory } from "../schema/records";
import type { Stamps } from "./fence";

export interface WithdrawalInput {
  opId: ID;
  stamps: Stamps;
  now: TS;
  withdrawn: Ref;
  memory: Memory | null;
  effects: readonly { id: ID; effect: Effect }[];
  hasher: Hasher;
}

export interface WithdrawalPlan {
  /** The withdrawn Memory's next state (unchanged when it is `wrong`), or null when it is not a Memory. */
  memory: Memory | null;
  /** Effects premised on the withdrawn row, now `retracted`. */
  retracted: { id: ID; effect: Effect }[];
  /** The content-free holds that keep their restraint. */
  holds: { id: ID; effect: Effect }[];
}

const premises = (e: Effect, r: Ref) => e.premiseIds.some((p) => p.type === r.type && p.id === r.id);

/** The content-free hold that keeps an exclude, quiet or care hold's restraint (contracts §1 effects). */
export function withdrawnHold(effect: Effect, stamps: Stamps, now: TS): Effect | null {
  if (!(HOLD_KINDS as readonly string[]).includes(effect.kind)) return null;
  return {
    ...effect,
    epoch: stamps.epoch,
    policyRev: stamps.policyRev,
    rev: 1,
    createdAt: now,
    updatedAt: now,
    rootKeys: [],
    rootSlices: [],
    contextIds: [],
    packetEids: [],
    dependsOn: [],
    dirty: false,
    dependenciesComplete: true,
    premiseIds: [],
    kind: "withdrawnHold",
    holdKind: effect.kind as (typeof HOLD_KINDS)[number],
    contentFree: true,
    state: "active",
  };
}

export function planWithdrawal(i: WithdrawalInput): WithdrawalPlan {
  const retracted: { id: ID; effect: Effect }[] = [];
  const holds: { id: ID; effect: Effect }[] = [];
  for (const { id, effect } of i.effects) {
    if (effect.state !== "active" || !premises(effect, i.withdrawn)) continue;
    retracted.push({ id, effect: { ...effect, state: "retracted", updatedAt: i.now } });
    const hold = withdrawnHold(effect, i.stamps, i.now);
    if (hold === null) continue;
    // One hold per kind, target and scope; two restraints on the same thing keep the higher sensitivity.
    const id2 = i.hasher.id(["withdrawnHold", i.opId, hold.holdKind, hold.target, hold.scope]);
    const same = holds.find((h) => h.id === id2);
    if (same === undefined) holds.push({ id: id2, effect: hold });
    else same.effect = { ...same.effect, minSens: maxSens(same.effect.minSens, hold.minSens) };
  }
  let memory: Memory | null = null;
  if (i.memory !== null) memory = i.memory.status === "wrong" ? i.memory : { ...i.memory, status: "retracted", updatedAt: i.now };
  return { memory, retracted, holds };
}
