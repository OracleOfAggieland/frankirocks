/**
 * The fence, server half (spec §8 step 2; contracts §8 step 2; KV07). One transaction: `core/epoch` raised (the epoch;
 * policyRev is held back by ruling F-18) with
 * the barrier set (or the op added to its queue), `core/bundle` burned, the forget job at phase `close`, the
 * `forgetReceipt` ledger entry (state `pending`), and the request turns marked `dead` with their items added to
 * the Session's `deadItemIds`. The request turn dies here: it is never a safe turn, never extracted, never chunked.
 * Every Extract_Job captured before the fence fails `STALE` at its commit, since the epoch rose.
 *
 * No route calls this in this part (brief 021).
 */
import {
  type CoreBundle,
  type CoreEpoch,
  type Hasher,
  type ID,
  type Job,
  type Ledger,
  type Session,
  type Turn,
  bundleAfter,
  planFence,
  receiptPayload,
  tsFromMs,
} from "@franki/core";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { forgetJob } from "../worker/jobs";

export interface FenceInput {
  sessionId: ID;
  /** The request's own idempotency key, so a retried request finds its op. */
  requestId: string;
  requestTurnIds: ID[];
}

export type FenceResult =
  | { kind: "fenced" | "queued" | "retry"; opId: ID; jobId: ID; receiptId: ID; epoch: number; policyRev: number }
  | { kind: "refused"; code: "BARRIER" };

export const forgetOpId = (uid: string, sessionId: ID, requestId: string, hasher: Hasher): ID => hasher.id(["forget", uid, sessionId, requestId]);
export const forgetJobId = (opId: ID, hasher: Hasher): ID => hasher.id(["job", "forget", opId]);
export const forgetReceiptId = (opId: ID, hasher: Hasher): ID => hasher.id(["ledger", "forgetReceipt", opId]);

export async function fenceForget(store: StorePort, uid: string, input: FenceInput, opsNow: number, hasher: Hasher): Promise<FenceResult> {
  const opId = forgetOpId(uid, input.sessionId, input.requestId, hasher);
  const jobId = forgetJobId(opId, hasher);
  const receiptId = forgetReceiptId(opId, hasher);
  const now = tsFromMs(opsNow);
  return store.transaction(uid, async (tx) => {
    const epochDoc = await tx.get<CoreEpoch>(paths.core(uid, "epoch"));
    if (epochDoc === null) throw new Error("fenceForget: core/epoch is missing");
    const prior = await tx.get<Job>(paths.job(uid, jobId));
    const plan = planFence(epochDoc.data, { opId, requestRef: null, requestTurnIds: input.requestTurnIds }, now, prior === null ? null : { epoch: prior.data.epoch, policyRev: prior.data.policyRev });
    if (plan.kind === "refused") return plan;
    const ids = { opId, jobId, receiptId, epoch: plan.captured.epoch, policyRev: plan.captured.policyRev };
    if (plan.kind === "retry") return { kind: "retry", ...ids };

    // Dead-mark the request turns that exist (a request may fence before its transcript commits).
    const session = await tx.get<Session>(paths.session(uid, input.sessionId));
    const deadItems: { sessionId: ID; itemId: string }[] = [];
    for (const turnId of input.requestTurnIds) {
      const turn = await tx.get<Turn>(paths.turn(uid, input.sessionId, turnId));
      if (turn === null) continue;
      for (const itemId of turn.data.itemIds) deadItems.push({ sessionId: input.sessionId, itemId });
      if (turn.data.state !== "dead") tx.update(turn.path, { ...turn.data, state: "dead", updatedAt: now });
    }
    if (session !== null && deadItems.length > 0) {
      const dead = [...new Set([...session.data.deadItemIds, ...deadItems.map((d) => d.itemId)])].slice(-64);
      tx.update(session.path, { ...session.data, deadItemIds: dead, updatedAt: now });
    }
    tx.update(epochDoc.path, plan.epoch);
    if (plan.kind === "queued") return { kind: "queued", ...ids };

    const bundleDoc = await tx.get<CoreBundle>(paths.core(uid, "bundle"));
    if (bundleDoc !== null) {
      const b = bundleDoc.data;
      tx.update(bundleDoc.path, {
        ...b,
        epoch: plan.captured.epoch,
        policyRev: plan.captured.policyRev,
        state: bundleAfter(b.state, "burned"),
        bundleRev: b.bundleRev + 1,
        head: null,
        headHash: null,
        selectedRefs: [],
        updatedAt: now,
      });
    }
    tx.create(
      paths.job(uid, jobId),
      forgetJob({ uid, now: opsNow, epoch: plan.captured.epoch, policyRev: plan.captured.policyRev, opId, sessionId: input.sessionId, requestTurnIds: input.requestTurnIds, deadItems }),
    );
    const receipt: Ledger = {
      ...cFields(uid, now, plan.captured.epoch, plan.captured.policyRev),
      kind: "forgetReceipt",
      state: "pending",
      at: now,
      retainUntil: null,
      payload: receiptPayload(opId, null, false),
    };
    tx.create(paths.ledger(uid, receiptId), receipt);
    return { kind: "fenced", ...ids };
  });
}
