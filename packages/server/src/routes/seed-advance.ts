/**
 * POST /api/seed/advance (contracts §6 Routes: `{R, fixtureNamespace, to}` to `{worldClock, jobId, proactive?, deck?}`;
 * "monotone world, barrier 423, force tick"; KS09; brief 023 task 5; design note 023 §4). The jump, for one visitor:
 *
 *   1. One transaction moves `core/state.worldClock` to `to` through `setWorldClock`, and nothing else. A barrier
 *      (a forget or a reset in progress) answers BARRIER 423 with a retry hint: the browser's retry is the wait.
 *      Backward is refused; an equal `to` moves nothing and still ticks. The ops clock is never written.
 *   2. The forced `memoryTick` at the new world time, past the once-a-minute gate. It writes moments only, so facts
 *      and actions are preserved.
 *   3. One transaction writes a complete `derive` Job citing the opened moments and records the response.
 *
 * `proactive` and `deck` are null here: putting a chosen moment on the wire is the state route's seam
 * (`time/proactive.ts`), and the browser reads it on its next state call.
 */
import { type CoreDocs, type ID, type Infer, type Job, SeedAdvanceRequest, type SeedAdvanceResponse, msFromTs, tsFromMs } from "@franki/core";
import { ensureCoreDocs, readCoreDocs } from "../core-docs";
import { completeRequest } from "../ledger/request";
import { cFields } from "../records";
import { setWorldClock } from "../seed/clock-state";
import { paths } from "../store/paths";
import { memoryTick } from "../time/tick";
import { RouteError, parseError, staleError } from "./errors";
import { mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

export type AdvanceReq = Infer<typeof SeedAdvanceRequest>;
export type AdvanceRes = Infer<typeof SeedAdvanceResponse>;

/** The retry hint a jump answers while a forget or reset holds the tenant (design note 023 gap 8). */
export const ADVANCE_RETRY_MS = 1_000;
/** Moments a jump's derive Job cites (Job `resultRefs` cap). */
const RESULT_REFS_MAX = 32;

const barrierRetry = () => new RouteError("BARRIER", 423, ADVANCE_RETRY_MS, "advance");

export type AdvancePlan = { ok: true; to: number; moved: boolean } | { ok: false; error: "BARRIER" | "STALE" | "PARSE" };

/** Whether a jump to `to` may run against these core documents (pure; KS09, monotone world). */
export function planAdvance(core: { epoch: CoreDocs["epoch"]; state: CoreDocs["state"] }, fixtureNamespace: ID, to: number): AdvancePlan {
  if (core.epoch.barrier !== null) return { ok: false, error: "BARRIER" };
  const s = core.state;
  if (s.clockMode !== "fixture" || s.worldClock === null || s.fixtureNamespace !== fixtureNamespace) return { ok: false, error: "STALE" };
  const world = msFromTs(s.worldClock);
  if (!Number.isSafeInteger(to) || to < world) return { ok: false, error: "PARSE" };
  return { ok: true, to, moved: to > world };
}

function deriveJob(uid: string, opsNow: number, core: { epoch: number; policyRev: number }, opened: readonly ID[]): Job {
  const now = tsFromMs(opsNow);
  return {
    ...cFields(uid, now, core.epoch, core.policyRev),
    kind: "derive",
    status: "complete",
    priority: "interactive",
    nextAttemptAt: now,
    leaseUntil: null,
    leaseToken: null,
    generation: 0,
    attempts: 1,
    sourceIds: [],
    inputRevs: [],
    connectorId: null,
    syncGeneration: null,
    payload: { kind: "work", task: "derive", targets: [], class: null, fields: [], cursor: { fieldIndex: 0, offset: 0, afterId: null, leg: "exact" }, query: null },
    resultRefs: opened.slice(0, RESULT_REFS_MAX).map((id) => ({ type: "moment" as const, id, rev: 1 })),
    error: null,
    retainUntil: null,
  };
}

export async function seedAdvance(ctx: RouteContext, req: AdvanceReq): Promise<AdvanceRes> {
  const { uid, deps } = ctx;
  await ensureCoreDocs(uid, deps);
  return mutation(ctx, "advance", req.requestId, req, async (key) => {
    const to = msFromTs(req.to);
    await deps.store.transaction(uid, async (tx) => {
      const core = await readCoreDocs(tx, uid);
      const plan = planAdvance({ epoch: core.epoch.data, state: core.state.data }, req.fixtureNamespace, to);
      if (!plan.ok) throw plan.error === "BARRIER" ? barrierRetry() : plan.error === "STALE" ? staleError("advance") : parseError("backward");
      if (plan.moved) await setWorldClock(tx, uid, req.fixtureNamespace, to, deps.clock.read().opsClock.now);
    });

    const report = await memoryTick(ctx);
    // A forget began after the move: the world clock stays moved, and the retry ticks again.
    if (report.skipped === "barrier") throw barrierRetry();

    const jobId = deps.hasher.id(["advance-derive", req.fixtureNamespace, req.requestId]) as ID;
    return deps.store.transaction(uid, async (tx) => {
      const core = await readCoreDocs(tx, uid);
      if (core.epoch.data.barrier !== null) throw barrierRetry();
      const ops = deps.clock.read().opsClock.now;
      const response: AdvanceRes = { worldClock: core.state.data.worldClock ?? tsFromMs(to), jobId, proactive: null, deck: null };
      if ((await tx.get(paths.job(uid, jobId))) === null) tx.create(paths.job(uid, jobId), deriveJob(uid, ops, core.epoch.data, report.opened));
      await completeRequest(tx, key, response, ops);
      return response;
    });
  });
}

export const seedAdvanceRoute: RouteSpec<AdvanceReq> = {
  name: "advance",
  parse: ({ body }) => parseWith(SeedAdvanceRequest, body),
  run: (ctx, req) => seedAdvance(ctx, req),
};
