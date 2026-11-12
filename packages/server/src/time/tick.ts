/**
 * `memoryTick` (brief 023 task 4; spec §5 Triggers; contracts tickUser Q09, Q15, Q16, Q35; design note 023 §3).
 * For one owner, at the owner's world time:
 *
 *   1. derive: every Memory (paged by ID, at most MEMORY_SCAN_MAX; more and derive writes nothing this tick), the
 *      hero pattern and the reminders become moment plans, merged into stored rows one transaction each, only where
 *      a row changes;
 *   2. open: every due pending moment, expired lease, and closed leased or admitted moment, in (dueAt, id) order, in
 *      its own transaction that rereads the moment, `core/epoch` (a barrier stops the tick), `core/state` (the
 *      world clock), the source with its dependencies, the blocks and the effects on it, and applies `planTick`.
 *
 * It writes moments only: no Memory, Evidence or action changes (time can only ask). No cron: it runs from the
 * scheduled tick of open, state and receipt (`worker/tick.ts`, once an ops minute) and from a jump, which forces it.
 */
import {
  type CoreDocs,
  type Effect,
  type Evidence,
  type ID,
  type Ledger,
  type Memory,
  type Moment,
  type MomentPlan,
  type RowContext,
  type Snapshot,
  type SourceVerdict,
  type Transition,
  type Block,
  derivePattern,
  deriveExpiry,
  deriveLoop,
  deriveOccasion,
  deriveReminder,
  docRef,
  eligible,
  heroRollupId,
  mergeMoment,
  msFromTs,
  parseDep,
  planTick,
  retireMoment,
  sourceVerdict,
  tickRowOf,
  tsFromMs,
} from "@franki/core";
import { ownerClock, readCoreDocs } from "../core-docs";
import { foregroundEC, storeReader } from "../head-build";
import { heroOffer, compareLoop } from "../routes/tool-food";
// Brief 030 P1-3: the loop's check at checkAt, stored.
import { storeLoopCheck } from "./loop-check";
import type { RouteContext } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { Reader, StoredDoc, Tx } from "../store/port";

/** Memories one tick reads for derive; past it, derive writes nothing that tick (fails closed). */
export const MEMORY_SCAN_MAX = 2_000;
/** Moments one tick may open or close (contracts page limit). */
export const TICK_PAGE = 100;
/** Moment rows one tick reads; past it, the tick opens nothing (fails closed). */
export const MOMENT_SCAN_MAX = 2_000;
/** Blocks and effects reread at open (contracts Snapshot `blocks` cap). */
const REREAD_MAX = 100;
/** Hold effects that stop a moment about their target or subject. */
const HOLDING_EFFECTS: readonly Effect["kind"][] = ["quiet", "careHold", "celebrationHold"];

export interface TickReport {
  /** `barrier`: a forget or reset holds the tenant; `noCore`: no core documents yet. Nothing was written. */
  skipped: "barrier" | "noCore" | null;
  derived: number;
  opened: ID[];
  transitions: Transition[];
}

async function scanMemories(reader: Reader, uid: string): Promise<StoredDoc<Memory>[] | null> {
  const out: StoredDoc<Memory>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: StoredDoc<Memory>[] = await reader.query<Memory>({
      collection: paths.collection(uid, "memories"),
      where: cursor === null ? [] : [{ field: "__name__", op: ">", value: cursor }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: 100,
    });
    out.push(...page);
    if (out.length > MEMORY_SCAN_MAX) return null;
    if (page.length < 100) return out;
    cursor = page[page.length - 1]!.id;
  }
}

async function reminderActions(reader: Reader, uid: string): Promise<StoredDoc<Extract<Ledger, { kind: "action" }>>[]> {
  const rows = await reader.query<Ledger>({ collection: paths.collection(uid, "ledger"), where: [{ field: "kind", op: "==", value: "action" }], orderBy: { field: "at", dir: "desc" }, limit: 64 });
  return rows.filter((r): r is StoredDoc<Extract<Ledger, { kind: "action" }>> => r.data.kind === "action" && r.data.payload.executor === "makeReminder");
}

/**
 * Every moment row of the owner, paged by ID (Q28), or null past MOMENT_SCAN_MAX. Q15, Q16 and Q35 have no declared
 * index yet (`store/indexes.ts` and `firestore.indexes.json` aren't this lane's), so their filters run in code over
 * this scan (design note 023, ruling `MOMENT_SCAN_MAX`).
 */
export async function scanMoments(reader: Reader, uid: string): Promise<StoredDoc<Moment>[] | null> {
  const out: StoredDoc<Moment>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: StoredDoc<Moment>[] = await reader.query<Moment>({
      collection: paths.collection(uid, "moments"),
      where: cursor === null ? [] : [{ field: "__name__", op: ">", value: cursor }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: 100,
    });
    out.push(...page);
    if (out.length > MOMENT_SCAN_MAX) return null;
    if (page.length < 100) return out;
    cursor = page[page.length - 1]!.id;
  }
}

function insightDues(moments: readonly StoredDoc<Moment>[], rollupId: string): { momentId: string; dueAt: number }[] {
  return moments.filter((r) => r.data.rollupId === rollupId && r.data.status !== "cancelled").map((r) => ({ momentId: r.id, dueAt: msFromTs(r.data.dueAt) }));
}

/** Every plan this owner's rows derive now, and the IDs that must not stay pending. */
async function derivePlans(ctx: RouteContext, reader: Reader, zone: string): Promise<{ plans: MomentPlan[]; retired: string[]; rollupLive: boolean } | null> {
  const { uid, deps } = ctx;
  const memories = await scanMemories(reader, uid);
  if (memories === null) {
    deps.log("time.deriveSkipped", { reason: "scanLimit" });
    return null;
  }
  const rows = new Map(memories.map((d) => [d.id, d.data]));
  const plans: MomentPlan[] = [];
  const retired: string[] = [];
  for (const { data: m } of memories) {
    for (const out of [deriveOccasion(m, rows, deps.hasher), deriveLoop(m, deps.hasher), deriveExpiry(m, zone, deps.hasher)]) {
      plans.push(...out.plans);
      retired.push(...out.retired);
    }
  }
  for (const a of await reminderActions(reader, uid)) plans.push(...deriveReminder(a.id, a.data, deps.hasher).plans);
  let rollupLive = false;
  const offer = await heroOffer(ctx, 0).catch(() => null);
  if (offer !== null) {
    const rollupId = heroRollupId(deps.hasher);
    const moments = await scanMoments(reader, uid);
    if (moments === null) return null;
    const out = derivePattern(offer.pattern, insightDues(moments, rollupId), deps.hasher);
    rollupLive = true;
    plans.push(...out.plans);
  }
  return { plans, retired, rollupLive };
}

const rowContext = (uid: string, core: { epoch: CoreDocs["epoch"]; state: CoreDocs["state"] }, opsNow: number): RowContext => ({
  uid,
  opsNow,
  epoch: core.epoch.epoch,
  policyRev: core.epoch.policyRev,
  clockMode: core.state.clockMode,
});

/** Writes one plan (or one retirement) if it changes the stored row. Returns true when it wrote. */
async function writePlan(ctx: RouteContext, plan: MomentPlan | null, retiredId: string | null): Promise<boolean> {
  const { uid, deps } = ctx;
  const id = plan?.momentId ?? retiredId!;
  const path = paths.moment(uid, id);
  // A plain read first: most ticks change nothing, and a no-op needs no transaction.
  const seen = await deps.store.get<Moment>(uid, path);
  const ops = deps.clock.read().opsClock.now;
  const peek = plan !== null ? (seen === null ? true : seen.data.status === "pending") : seen?.data.status === "pending";
  if (!peek) return false;
  return deps.store.transaction(uid, async (tx) => {
    const core = await readCoreDocs(tx, uid);
    if (core.epoch.data.barrier !== null) return false;
    const doc = await tx.get<Moment>(path);
    const c = rowContext(uid, { epoch: core.epoch.data, state: core.state.data }, ops);
    const next = plan !== null ? mergeMoment(doc?.data ?? null, plan, c, deps.hasher) : retireMoment(doc?.data ?? null, c);
    if (next === null) return false;
    if (doc === null) tx.create(path, next);
    else tx.update(path, next);
    return true;
  });
}

/** The moments this tick may move: due pending ones (Q15), expired leases (Q16), closed admitted (Q35) or leased ones. */
function candidates(moments: readonly StoredDoc<Moment>[], worldNow: number, opsNow: number): StoredDoc<Moment>[] {
  const due = moments.filter(({ data: m }) => {
    if (m.status === "pending") return msFromTs(m.dueAt) <= worldNow;
    if (m.status === "leased") return (m.leaseUntil !== null && msFromTs(m.leaseUntil) <= opsNow) || msFromTs(m.closeAt) <= worldNow;
    if (m.status === "admitted") return msFromTs(m.closeAt) <= worldNow;
    return false;
  });
  return due.sort((a, b) => msFromTs(a.data.dueAt) - msFromTs(b.data.dueAt) || (a.id < b.id ? -1 : 1)).slice(0, TICK_PAGE);
}

/** Rereads a Memory source in the transaction: its row, its dependencies, the blocks and the hold effects. */
async function memoryVerdict(tx: Tx, uid: string, moment: Moment, memoryId: string, core: Awaited<ReturnType<typeof readCoreDocs>>, ctx: RouteContext): Promise<SourceVerdict> {
  const doc = await tx.get<Memory>(paths.memory(uid, memoryId));
  const m = doc?.data ?? null;
  // A moved occasion speaks for its newest row; the moment's note names it.
  const noteId = moment.payload.kind === "cue" && moment.payload.noteRef.type === "memory" ? moment.payload.noteRef.id : memoryId;
  const current = noteId === memoryId ? m : ((await tx.get<Memory>(paths.memory(uid, noteId)))?.data ?? null);
  const plain = sourceVerdict(current);
  if (plain !== "ok" || current === null) return plain;
  // Every dependency must be in the snapshot, or eligible denies the row.
  const deps: { ref: ReturnType<typeof docRef>; row: Evidence | Memory }[] = [];
  for (const dep of current.dependsOn) {
    const parsed = parseDep(dep);
    if (parsed === null) return "gone";
    if (parsed.collection === "evidence") {
      const e = await tx.get<Evidence>(paths.evidence(uid, parsed.id));
      if (e !== null) deps.push({ ref: docRef("evidence", e.id, e.data.rev), row: e.data });
    } else {
      const d = await tx.get<Memory>(paths.memory(uid, parsed.id));
      if (d !== null) deps.push({ ref: docRef("memories", d.id, d.data.rev), row: d.data });
    }
  }
  const blocks = await tx.query<Block>({ collection: paths.collection(uid, "blocks"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: REREAD_MAX });
  const pair = ownerClock(core.state.data, ctx.deps.clock);
  // An expiry ask is about a row whose bound has passed: read it as it stood just before.
  const world = moment.kind === "expiryAsk" && current.validTo !== null ? Math.min(pair.worldClock.now, msFromTs(current.validTo) - 1) : pair.worldClock.now;
  const ec = { ...foregroundEC(uid, core.epoch.data, { ...pair, worldClock: { ...pair.worldClock, now: world } }, 0), stage: "read" as const, purpose: "proactive" as const };
  const snapshot: Snapshot = {
    uid,
    epoch: core.epoch.data,
    session: null,
    job: null,
    localGeneration: 0,
    refs: [docRef("memories", noteId, current.rev), ...deps.map((d) => d.ref)],
    rows: [current, ...deps.map((d) => d.row)],
    blocks: blocks.map((b) => b.data),
    coverage: core.state.data.coverage,
    complete: blocks.length < REREAD_MAX,
  };
  const er = eligible({ ref: docRef("memories", noteId, current.rev), row: current }, ec, snapshot);
  if (!er.allow) return er.reason === "blocked" ? "forgotten" : "gone";
  // Q25 has no declared index here; the first page by ID, filtered in code. A full page fails closed.
  const effectPage = await tx.query<Effect>({ collection: paths.collection(uid, "effects"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: REREAD_MAX });
  if (effectPage.length >= REREAD_MAX) return "gone";
  const effects = effectPage.filter((e) => e.data.state === "active");
  const subjects = new Set(moment.subjectIds.filter((s) => s !== "self"));
  const held = effects.some(
    (e) => HOLDING_EFFECTS.includes(e.data.kind) && ((e.data.target.id === memoryId || e.data.target.id === noteId) || (e.data.scope.subjectId !== null && subjects.has(e.data.scope.subjectId))),
  );
  return held ? "gone" : "ok";
}

/** Applies a moment's planned transitions to its row. */
function applied(m: Moment, ts: readonly Transition[], opsNow: number, leaseToken: ID): Moment {
  let next: Moment = { ...m, updatedAt: tsFromMs(opsNow) };
  for (const t of ts) {
    if (t.to === "pending") next = { ...next, status: "pending", leaseToken: null, leaseUntil: null, attempts: next.attempts + 1 };
    else if (t.to === "leased") next = { ...next, status: "leased", leaseToken, leaseUntil: tsFromMs(opsNow + 15 * 60_000), generation: next.generation + 1 };
    else if (t.to === "cancelled") next = { ...next, status: "cancelled", cancelReason: t.why === "forgotten" ? "forgotten" : "policy", leaseToken: null, leaseUntil: null };
    else next = { ...next, status: t.to, leaseToken: null, leaseUntil: null };
  }
  return next;
}

/** One moment's open, close or cancel, in its own transaction. */
async function moveMoment(ctx: RouteContext, id: ID, rollupLive: boolean): Promise<Transition[] | "barrier"> {
  const { uid, deps } = ctx;
  const path = paths.moment(uid, id);
  // A celebrate's predicate reads money rows outside the transaction; the loop is reread inside it.
  const peek = await deps.store.get<Moment>(uid, path);
  const loopId = peek?.data.payload.kind === "celebrate" ? peek.data.payload.loopId : null;
  const comparison = loopId === null ? null : await compareLoop(ctx, loopId, 0).catch(() => null);
  return deps.store.transaction(uid, async (tx) => {
    const core = await readCoreDocs(tx, uid);
    if (core.epoch.data.barrier !== null) return "barrier" as const;
    const doc = await tx.get<Moment>(path);
    if (doc === null) return [];
    const m = doc.data;
    const pair = ownerClock(core.state.data, deps.clock);
    const ops = pair.opsClock.now;
    let verdict: SourceVerdict = "gone";
    if (m.memoryId !== null) verdict = await memoryVerdict(tx, uid, m, m.memoryId, core, ctx);
    else if (m.rollupId !== null) verdict = rollupLive ? "ok" : "gone";
    else if (m.actionId !== null) {
      const action = await tx.get<Ledger>(paths.ledger(uid, m.actionId));
      verdict = action !== null && action.data.kind === "action" && action.data.state === "complete" ? "ok" : "gone";
    }
    const passes = comparison !== null && comparison.lines !== null && comparison.takeout.status === "eligible";
    const ts = planTick({ rows: [tickRowOf(id, m)], worldNow: pair.worldClock.now, opsNow: ops, source: () => verdict, passes: () => passes });
    if (ts.length === 0) return ts;
    let next = applied(m, ts, ops, deps.hasher.id(["momentLease", id, m.attempts, m.generation, ops]) as ID);
    if (next.payload.kind === "celebrate" && next.status === "leased" && comparison !== null) {
      const before = comparison.takeout.beforeCents ?? null;
      const after = comparison.takeout.afterCents ?? null;
      next = { ...next, payload: { ...next.payload, before, after, delta: before !== null && after !== null ? before - after : null } };
    }
    // Brief 030 P1-3: the comparison's result is stored on the loop (read before this transaction's writes).
    if (next.payload.kind === "celebrate" && comparison !== null) await storeLoopCheck(tx, uid, comparison, ops);
    tx.update(path, next);
    return ts;
  });
}

/** The tick for one owner. Never throws for a lost race: that moment waits for the next tick. */
export async function memoryTick(ctx: RouteContext): Promise<TickReport> {
  const { uid, deps } = ctx;
  const reader = storeReader(deps.store, uid);
  const report: TickReport = { skipped: null, derived: 0, opened: [], transitions: [] };
  // An owner with no core documents yet has nothing to tick.
  if ((await reader.get(paths.core(uid, "epoch"))) === null) return { ...report, skipped: "noCore" };
  const core = await readCoreDocs(reader, uid);
  if (core.epoch.data.barrier !== null) return { ...report, skipped: "barrier" };
  const pair = ownerClock(core.state.data, deps.clock);

  const derived = await derivePlans(ctx, reader, pair.worldClock.zone);
  for (const p of derived?.plans ?? []) if (await guarded(ctx, () => writePlan(ctx, p, null))) report.derived++;
  for (const id of derived?.retired ?? []) await guarded(ctx, () => writePlan(ctx, null, id));

  const moments = await scanMoments(reader, uid);
  if (moments === null) {
    deps.log("time.tickSkipped", { reason: "scanLimit" });
    return report;
  }
  for (const doc of candidates(moments, pair.worldClock.now, pair.opsClock.now)) {
    const ts = await guarded(ctx, () => moveMoment(ctx, doc.id as ID, derived?.rollupLive ?? false));
    if (ts === "barrier") return { ...report, skipped: "barrier" };
    if (ts === null) continue;
    report.transitions.push(...ts);
    report.opened.push(...ts.filter((t) => t.to === "leased").map((t) => t.momentId as ID));
  }
  deps.log("time.tick", { derived: report.derived, opened: report.opened.length, moved: report.transitions.length });
  return report;
}

async function guarded<T>(ctx: RouteContext, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (!isStoreError(error, "staleRevision")) throw error;
    ctx.deps.log("time.lostRace", {});
    return null;
  }
}
