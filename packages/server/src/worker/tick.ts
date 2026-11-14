/**
 * `tick` (contracts §9 tickUser; design "Tick"; R14.4). At most once per ops minute per Owner:
 *   Q13  close expired live Sessions (at most 100 per run) through the hangup path, hangups scheduled;
 *   Q17  run due `queued` and `retry` jobs (hangup, then forget (brief 048 ruling 6), then errand (brief 049), here;
 *        extract through the drain);
 *   Q18  requeue jobs whose lease expired.
 * `startTick` returns the bounded Q13 part as a promise (session open awaits it) and schedules the rest; the state
 * and receipt routes schedule all of it and never await it.
 *
 * The once-per-minute gate is held per Store_Port instance and Owner. contracts §1 `core/state` has no field for a
 * tick watermark, so the gate is in-process (design deviation, see tasks.md task 18). Duplicate runs across
 * processes are harmless: every step is a compare-and-set on the rows it touches.
 */
import { type ID, type Job, type Session, tsFromMs } from "@franki/core";
import type { RouteContext } from "../routes/runtime";
import { afterClosed, beginCloseInTx, finishCloseInTx } from "../sessions";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { drainExtractJobs } from "./drain";
import { hangupAll, runHangupJob } from "./hangup";
import { dueJobs } from "./jobs";
// Brief 023: one-shot time.
import { memoryTick } from "../time/tick";
// Brief 048: forget is a job kind the tick runs.
import { runDueForgets } from "../forget/drive";
// Brief 049 part A.
import { runErrand } from "../errands/run";

const MINUTE_MS = 60_000;
export const EXPIRY_BATCH = 100;
/** Hangup budget for an expiry close; the work is scheduled, so this bounds background time only. */
const EXPIRY_HANGUP_BUDGET_MS = 1_500;

const gates = new WeakMap<StorePort, Map<string, number>>();

/** True (and consumes the slot) when this Owner has not ticked in the current ops minute. */
export function takeTickSlot(store: StorePort, uid: string, opsNow: number): boolean {
  let byUid = gates.get(store);
  if (byUid === undefined) gates.set(store, (byUid = new Map()));
  const minute = Math.floor(opsNow / MINUTE_MS);
  if (byUid.get(uid) === minute) return false;
  byUid.set(uid, minute);
  return true;
}

/** Q13: Sessions live past `expiresAt`. Returns how many it moved to closing or closed. */
export async function expireSessions(ctx: RouteContext): Promise<number> {
  const { uid, deps } = ctx;
  const now = deps.clock.read().opsClock.now;
  const expired: ID[] = [];
  for (const status of ["minting", "active", "quarantined", "closing"] as const) {
    if (expired.length >= EXPIRY_BATCH) break;
    const rows = await deps.store.query<Session>(uid, {
      collection: paths.collection(uid, "sessions"),
      where: [
        { field: "status", op: "==", value: status },
        { field: "expiresAt", op: "<=", value: tsFromMs(now) },
      ],
      orderBy: { field: "expiresAt", dir: "asc" },
      limit: EXPIRY_BATCH - expired.length,
    });
    expired.push(...rows.map((r) => r.id));
  }
  for (const sessionId of expired) {
    // A close that loses its compare-and-set race is left to the next tick, so Q13 never fails a session open (B2).
    const begun = await lostRaceAsNull(ctx, "expiry", () => deps.store.transaction(uid, (tx) => beginCloseInTx(tx, uid, sessionId, now)));
    if (begun === null) continue;
    if (begun.closed) {
      await afterClosed(ctx, sessionId);
      continue;
    }
    ctx.schedule(async () => {
      const ok = await hangupAll(begun.callIds, deps, EXPIRY_HANGUP_BUDGET_MS);
      const t = deps.clock.read().opsClock.now;
      const state = await deps.store.transaction(uid, (tx) => finishCloseInTx(tx, uid, sessionId, ok, t, ctx));
      if (state === "closed") await afterClosed(ctx, sessionId);
    });
  }
  return expired.length;
}

/** Q18: requeue jobs whose lease expired. */
export async function requeueExpiredLeases(ctx: RouteContext): Promise<number> {
  const { uid, deps } = ctx;
  const now = deps.clock.read().opsClock.now;
  const rows = await deps.store.query<Job>(uid, {
    collection: paths.collection(uid, "jobs"),
    where: [
      { field: "status", op: "==", value: "leased" },
      { field: "leaseUntil", op: "<=", value: tsFromMs(now) },
    ],
    orderBy: { field: "leaseUntil", dir: "asc" },
    limit: 100,
  });
  let n = 0;
  for (const row of rows) {
    await deps.store.transaction(uid, async (tx) => {
      const doc = await tx.get<Job>(row.path);
      if (doc === null || doc.data.status !== "leased" || doc.data.leaseUntil === null || doc.data.leaseUntil > tsFromMs(now)) return;
      tx.update(doc.path, { ...doc.data, status: "retry", leaseToken: null, leaseUntil: null, nextAttemptAt: tsFromMs(now), updatedAt: tsFromMs(now) });
      n++;
    });
  }
  return n;
}

/**
 * A step that lost a compare-and-set race (staleRevision) is left to the next tick; it must not stop the steps
 * after it, the extract drain above all. Every other error still throws.
 */
async function racing(ctx: RouteContext, step: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!isStoreError(error, "staleRevision")) throw error;
    ctx.deps.log?.("tick.lostRace", { step });
  }
}

/** As `racing`, for a step whose value is used: a lost race answers null. */
async function lostRaceAsNull<T>(ctx: RouteContext, step: string, run: () => Promise<T | null>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (!isStoreError(error, "staleRevision")) throw error;
    ctx.deps.log?.("tick.lostRace", { step });
    return null;
  }
}

/** Q17 for hangup Jobs, then the extract drain. */
export async function runDueJobs(ctx: RouteContext): Promise<void> {
  const { uid, deps } = ctx;
  for (const jobId of await dueJobs(deps.store, uid, deps.clock.read().opsClock.now, "hangup")) {
    // The attempt's commit can race Q13's expiry close of the same Session.
    await racing(ctx, "hangup", () => runHangupJob(uid, jobId, deps, (sessionId) => afterClosed(ctx, sessionId)));
  }
  // Brief 048 ruling 6: due forget jobs, after the hang-ups their close step reads.
  await racing(ctx, "forget", () => runDueForgets(ctx));
  // Brief 049 ruling 4: due errand runs (a lapsed lease is requeued by Q18 first). Review fix R10: each is scheduled,
  // never awaited here, so a run of up to a minute never holds the extract drain or the moments behind it.
  for (const jobId of await dueJobs(deps.store, uid, deps.clock.read().opsClock.now, "errand")) ctx.schedule(() => racing(ctx, "errand", () => runErrand(ctx, jobId)));
  await drainExtractJobs(uid, deps);
}

/**
 * Starts a tick if this Owner's minute slot is free. Returns the Q13 promise (await it to bound expiry before a
 * session open) and schedules Q18 then Q17. Returns null when the slot was already taken this minute.
 */
export function startTick(ctx: RouteContext): Promise<number> | null {
  if (!takeTickSlot(ctx.deps.store, ctx.uid, ctx.deps.clock.read().opsClock.now)) return null;
  const expiry = expireSessions(ctx);
  ctx.schedule(async () => {
    await expiry.catch(() => 0);
    await racing(ctx, "requeue", () => requeueExpiredLeases(ctx));
    await runDueJobs(ctx);
    // Brief 023: derive and open due moments at the owner's world time, after extraction has written its rows.
    await racing(ctx, "moments", () => memoryTick(ctx));
  });
  return expiry;
}

/** The whole tick as scheduled work, for routes that must not await it (state, receipt). */
export function scheduleTick(ctx: RouteContext): void {
  ctx.schedule(async () => {
    const expiry = startTick(ctx);
    if (expiry !== null) await expiry;
  });
}
