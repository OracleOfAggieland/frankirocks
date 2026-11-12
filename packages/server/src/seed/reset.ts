/**
 * The seed reset (brief 019 task 5). Not built yet: answers without clearing or seeding.
 */
import { type ID, type Infer, type SeedResetRequest, type SeedResetResponse, tsFromMs } from "@franki/core";
import { type RequestKey, completeRequest } from "../ledger/request";
import type { RouteContext } from "../routes/runtime";

export type ResetReq = Infer<typeof SeedResetRequest>;
export type ResetRes = Infer<typeof SeedResetResponse>;

export const namespaceFor = (ctx: RouteContext, req: ResetReq): ID => ctx.deps.hasher.id(["seed-ns", ctx.uid, req.visitId, req.requestId]);

export async function resetVisit(ctx: RouteContext, req: ResetReq, key: RequestKey): Promise<ResetRes> {
  const ops = ctx.deps.clock.read().opsClock.now;
  const res: ResetRes = { fixtureNamespace: namespaceFor(ctx, req), worldClock: tsFromMs(ops), sessionId: null };
  await ctx.deps.store.transaction(ctx.uid, (tx) => completeRequest(tx, key, res, ops));
  return res;
}
