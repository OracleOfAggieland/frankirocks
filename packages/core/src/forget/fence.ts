/**
 * The fence, pure (spec §8 step 2; contracts §1 core/epoch, §8 step 2; KV07). One small transaction raises the
 * epoch and the policy revision and sets the barrier; a forget that finds a barrier joins its queue, and the
 * barrier clears only when the queue is empty. A retry keeps the stamps its op first captured. The server half
 * (`packages/server/src/forget/fence.ts`) writes the plan in one transaction with the job, the burned bundle, the
 * receipt and the dead request turns.
 */
import { type ID, type Ref, type TS, msFromTs, tsFromMs } from "../schema/primitives";
import type { CoreEpoch } from "../schema/records";

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
export function planFence(epoch: CoreEpoch, req: FenceRequest, opsNow: TS, prior: Stamps | null): FencePlan {
  if (prior !== null) return { kind: "retry", captured: prior };
  const barrier = epoch.barrier;
  const queued = barrier?.queuedOps.find((q) => q.opId === req.opId);
  if (queued !== undefined) return { kind: "retry", captured: { epoch: queued.capturedEpoch, policyRev: queued.capturedPolicyRev } };
  if (barrier === null) {
    const captured = { epoch: epoch.epoch + 1, policyRev: epoch.policyRev + 1 };
    return { kind: "fenced", epoch: { ...epoch, ...captured, updatedAt: opsNow, barrier: ownBarrier(req.opId, opsNow, []) }, captured };
  }
  // The owner itself, retried before its job is readable, is still a retry: the barrier is never overwritten.
  if (barrier.opId === req.opId) return { kind: "retry", captured: { epoch: epoch.epoch, policyRev: epoch.policyRev } };
  if (barrier.queuedOps.length >= FENCE_QUEUE_MAX) return { kind: "refused", code: "BARRIER" };
  const captured = { epoch: epoch.epoch, policyRev: epoch.policyRev };
  const entry = {
    opId: req.opId,
    kind: "forget" as const,
    requestRef: req.requestRef,
    requestTurnIds: req.requestTurnIds,
    capturedEpoch: captured.epoch,
    capturedPolicyRev: captured.policyRev,
    queuedOpsAt: opsNow,
  };
  return { kind: "queued", epoch: { ...epoch, updatedAt: opsNow, barrier: { ...barrier, queuedOps: [...barrier.queuedOps, entry] } }, captured };
}

function ownBarrier(opId: ID, opsNow: TS, queuedOps: NonNullable<CoreEpoch["barrier"]>["queuedOps"]): NonNullable<CoreEpoch["barrier"]> {
  // The fence commits in the transaction that writes the job, so the barrier starts at close (design note 021, gap 7).
  return { opId, phase: "close", startedAt: opsNow, deadline: tsFromMs(msFromTs(opsNow) + FENCE_DEADLINE_MS), queuedOps };
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
export function releaseBarrier(epoch: CoreEpoch, opId: ID, opsNow: TS): ReleasePlan {
  const barrier = epoch.barrier;
  if (barrier === null || barrier.opId !== opId) return { kind: "notOwner" };
  const [next, ...rest] = barrier.queuedOps;
  if (next === undefined) return { kind: "cleared", epoch: { ...epoch, updatedAt: opsNow, barrier: null } };
  return {
    kind: "promoted",
    epoch: { ...epoch, epoch: epoch.epoch + 1, policyRev: epoch.policyRev + 1, updatedAt: opsNow, barrier: ownBarrier(next.opId, opsNow, rest) },
    opId: next.opId,
    captured: { epoch: next.capturedEpoch, policyRev: next.capturedPolicyRev },
  };
}
