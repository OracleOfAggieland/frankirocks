/**
 * The fence, pure (spec §8 step 2; contracts §1 core/epoch, §8 step 2; KV07). One small transaction raises the
 * epoch and the policy revision and sets the barrier; a forget that finds a barrier joins its queue, and the
 * barrier clears only when the queue is empty. A retry keeps the stamps its op first captured. The server half
 * (`packages/server/src/forget/fence.ts`) writes the plan in one transaction with the job, the burned bundle, the
 * receipt and the dead request turns.
 */
import type { ID, Ref, TS } from "../schema/primitives";
import type { CoreEpoch } from "../schema/records";
import { NotBuilt } from "./not-built";

/** Contracts §8 step 2: the fence's deadline. */
export const FENCE_DEADLINE_MS = 1_500;
/** Contracts §1 core/epoch: `queuedOps` holds at most 32. */
export const FENCE_QUEUE_MAX = 32;

export interface Stamps {
  epoch: number;
  policyRev: number;
}

export interface FenceRequest {
  opId: ID;
  requestRef: Ref | null;
  requestTurnIds: ID[];
}

export type FencePlan =
  /** A new owner: the barrier is set and both revisions rose. `captured` is the op's stamps from now on. */
  | { kind: "fenced"; epoch: CoreEpoch; captured: Stamps }
  /** A barrier was up: the op joined its queue with the stamps it found. */
  | { kind: "queued"; epoch: CoreEpoch; captured: Stamps }
  /** The op is known already: nothing is written, and its first stamps stand. */
  | { kind: "retry"; captured: Stamps }
  /** The queue is full (contracts §1: 423). */
  | { kind: "refused"; code: "BARRIER" };

/**
 * `prior` is the op's stamps when the store already holds its job (a retry after the op left the queue, or of the
 * owner); null for an op the store has not seen.
 */
export function planFence(_epoch: CoreEpoch, _req: FenceRequest, _opsNow: TS, _prior: Stamps | null): FencePlan {
  throw new NotBuilt("planFence");
}

export type ReleasePlan =
  | { kind: "notOwner" }
  | { kind: "cleared"; epoch: CoreEpoch }
  /** The next queued op owns the barrier now; the revisions rose again for it. */
  | { kind: "promoted"; epoch: CoreEpoch; opId: ID; captured: Stamps };

/**
 * Ends `opId`'s hold on the barrier. Called by resume (spec §8 step 7), which this part does not build: nothing in
 * this part calls it outside tests.
 */
export function releaseBarrier(_epoch: CoreEpoch, _opId: ID, _opsNow: TS): ReleasePlan {
  throw new NotBuilt("releaseBarrier");
}
