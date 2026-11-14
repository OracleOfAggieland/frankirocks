/**
 * Who drives a forget job (brief 048 ruling 6). The turn route drives it right after the fence commits, inside one
 * named budget; after that the worker tick continues it (`forget` is a job kind the tick runs), and an open that meets
 * the barrier gives the tick one pass first. Every driver uses the same deps: the store, the live ForgetResolveV1 port
 * (or the one the route deps name), and the hang-up Job's CallClosePort.
 */
import type { ID } from "@franki/core";
import { raceLimit } from "../clock/timers";
import type { RouteContext } from "../routes/runtime";
import { afterClosed } from "../sessions";
import { dueJobs } from "../worker/jobs";
import { type AdvanceResult, type ForgetDeps, advanceForget } from "./executor";
import { hangupClosePort } from "./hangup-close";
import { liveForgetResolve } from "./resolve-live";

/** The turn route's share: the fence's own deadline (contracts §8 step 2). The rest is the tick's. */
export const FORGET_ROUTE_BUDGET_MS = 1_500;
/** Steps one tick pass gives each due forget job. On the seeded persona a whole forget is 16 steps. */
export const FORGET_TICK_STEPS = 32;

export function forgetDeps(ctx: RouteContext): ForgetDeps {
  const { deps } = ctx;
  return {
    store: deps.store,
    hasher: deps.hasher,
    resolver: deps.forgetResolve ?? liveForgetResolve(deps),
    closer: hangupClosePort(ctx.uid, deps, (id) => afterClosed(ctx, id)),
  };
}

/** Steps the job one at a time until it is done, waits, fails, or the budget is spent. */
export async function driveForget(ctx: RouteContext, jobId: ID, budgetMs: number, maxSteps = Number.POSITIVE_INFINITY): Promise<AdvanceResult> {
  const now = () => ctx.deps.clock.read().opsClock.now;
  const end = now() + budgetMs;
  let steps = 0;
  for (;;) {
    const r = await advanceForget(forgetDeps(ctx), ctx.uid, jobId, now(), { maxSteps: 1 });
    steps++;
    if (r.kind !== "paused" || now() >= end || steps >= maxSteps) return r;
  }
}

/** One pass over every due forget job (the tick's Q17, and the open that meets a barrier). */
export async function runDueForgets(ctx: RouteContext, steps = FORGET_TICK_STEPS): Promise<void> {
  for (const jobId of await dueJobs(ctx.deps.store, ctx.uid, ctx.deps.clock.read().opsClock.now, "forget")) {
    await driveForget(ctx, jobId, Number.POSITIVE_INFINITY, steps);
  }
}

/**
 * The open that met a barrier gives the forget one pass (ruling 6), inside the route's budget, so the client's retry
 * (the voice machine reconnects at 1, 2 and 5 s) usually finds the barrier cleared. What the budget does not cover runs
 * after the response. The open answered `blocked` from its own read of core/epoch, so this reads nothing first.
 */
export async function openForgetPass(ctx: RouteContext): Promise<void> {
  const pass = runDueForgets(ctx);
  if (!(await raceLimit(pass, FORGET_ROUTE_BUDGET_MS, ctx.deps.timers))) ctx.schedule(() => pass);
}
