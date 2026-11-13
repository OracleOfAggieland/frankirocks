/**
 * The forget executor (spec §8 steps 3 to 5; contracts §8; brief 021). `advanceForget` leases one forget job and
 * runs its phases in order, each committed with the job's new phase and cursor in one transaction that rechecks the
 * lease and the barrier, so a lost lease commits nothing and a retry resumes where the last commit left off:
 *
 *   close   records every registered call as `pending` in `closeCalls` (it hangs nothing up: ruling F-4);
 *   resolve builds the ForgetResolveV1 input, asks the port, checks the answer in code, stores the manifest
 *           (`candidateRefs`, `scopePending`) and writes a redact overlay for each verified range (ruling F-7);
 *   install writes `planInstall`'s pages: blocks and overlays, then the named Memories and effects, then the
 *           sanitized Evidence and `core/rules` in one page.
 *
 * Then it stops: the job is left `blocked` in phase `closure` (FORGET_STOP_PHASE), the barrier stays up at
 * `closure`, and the receipt stays `pending` with `blockedAt` null. Closure, resume and purge are reserved, so no
 * forget can complete here, and nothing says or shows "Gone". No route calls this code.
 */
import {
  type CoreEpoch,
  type CoreRules,
  type Effect,
  type Evidence,
  FORGET_PAGE_DOCS,
  type ForgetPhase,
  type Hasher,
  type ID,
  type InstallWrite,
  type Job,
  type Ledger,
  type Memory,
  type Overlay,
  type SC,
  type ResolveTurn,
  type Session,
  type Span,
  type Turn,
  canonicalJSON,
  checkResolve,
  evidenceFieldText,
  forgetPhaseRuns,
  installPages,
  msFromTs,
  nextForgetPhase,
  planInstall,
  receiptPayload,
  redactOverlayId,
  releaseBarrier,
  resolveInput,
  targetRefs,
  tsFromMs,
} from "@franki/core";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { StorePort, StoredDoc, Tx } from "../store/port";
import { claimJob } from "../worker/jobs";
import { type CallClosePort, NO_CALL_CLOSE } from "./close-port";
import { forgetReceiptId } from "./fence";
import type { ForgetResolvePort } from "./resolve-port";

export const FORGET_LEASE_MS = 30_000;
export const FORGET_RETRY_MS = 5_000;
/** Effects read per forget; past this, install stops `blocked` with LIMIT rather than retract only some. */
export const FORGET_EFFECTS_MAX = 1_000;
/** Turns read per page from the request's Session. */
const TURNS_PAGE = 100;
const SESSION_STATUSES_WITH_CALLS = ["minting", "active", "quarantined", "closing"] as const;

export interface ForgetDeps {
  store: StorePort;
  hasher: Hasher;
  resolver: ForgetResolvePort;
  /** Hangs up the registered calls (ruling 7). Absent: no call is ever confirmed closed, so nothing completes. */
  closer?: CallClosePort;
}

export type AdvanceResult =
  | { kind: "notClaimed" }
  /** The job reached `done`. */
  | { kind: "done" }
  /** `maxSteps` steps committed; the job is `queued` again at `phase`. */
  | { kind: "paused"; phase: ForgetPhase }
  /** Resume may not clear the barrier yet (ruling 6); the job is `retry` at `phase`. */
  | { kind: "waiting"; phase: ForgetPhase; reason: "calls" | "closure" | "queue" }
  | { kind: "lostLease" }
  | { kind: "retry"; phase: ForgetPhase }
  | { kind: "blocked"; reason: "notForget" | "barrier" | "limit" | "phase" };

type ForgetPayload = Extract<Job["payload"], { kind: "forget" }>;
const forgetOf = (job: Job): ForgetPayload => job.payload as ForgetPayload;

class LostLease extends Error {}
class BarrierGone extends Error {}
/** core/rules moved since install read it: the page commits nothing and the job retries from fresh rules. */
class RulesMoved extends Error {}

interface Lease {
  token: ID;
  generation: number;
}

/** One committed step: rechecks the lease and the barrier, then applies `fn` and writes the job it returns. */
async function commitStep(
  store: StorePort,
  uid: string,
  jobId: ID,
  lease: Lease,
  fn: (tx: Tx, job: Job, epoch: { path: string; data: CoreEpoch }) => Promise<Job>,
  /** False for a step that may run after the barrier moved on (purge, and resume after a hand-over). */
  ownBarrier = true,
): Promise<Job> {
  return store.transaction(uid, async (tx) => {
    const doc = await tx.get<Job>(paths.job(uid, jobId));
    if (doc === null || doc.data.status !== "leased" || doc.data.leaseToken !== lease.token || doc.data.generation !== lease.generation) throw new LostLease();
    const epoch = await tx.get<CoreEpoch>(paths.core(uid, "epoch"));
    if (epoch === null) throw new BarrierGone();
    if (ownBarrier && (epoch.data.barrier === null || epoch.data.barrier.opId !== forgetOf(doc.data).opId)) throw new BarrierGone();
    const next = await fn(tx, doc.data, epoch);
    tx.update(doc.path, next);
    return next;
  });
}

function withPhase(job: Job, phase: ForgetPhase, now: string, patch: Partial<ForgetPayload> = {}): Job {
  return { ...job, updatedAt: now, payload: { ...forgetOf(job), ...patch, phase } };
}

function barrierAt(tx: Tx, epoch: { path: string; data: CoreEpoch }, phase: ForgetPhase, now: string): void {
  const b = epoch.data.barrier!;
  if (phase === "purge" || phase === "done" || b.phase === phase) return;
  tx.update(epoch.path, { ...epoch.data, updatedAt: now, barrier: { ...b, phase } });
}

const docPath = (uid: string, w: InstallWrite): string => {
  switch (w.collection) {
    case "blocks":
      return paths.block(uid, w.id);
    case "overlays":
      return paths.overlay(uid, w.id);
    case "memories":
      return paths.memory(uid, w.id);
    case "effects":
      return paths.effect(uid, w.id);
    case "evidence":
      return paths.evidence(uid, w.id);
    case "core":
      return paths.core(uid, "rules");
    default:
      w satisfies never;
      throw new Error("unknown install write");
  }
};

/** Equal apart from the store-owned `rev` and the time of the write. */
const sameRecord = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const strip = ({ rev: _r, updatedAt: _u, ...rest }: Record<string, unknown>) => rest;
  return canonicalJSON(strip(a)) === canonicalJSON(strip(b));
};

/** Writes what changed; returns how many documents it really wrote, by collection. */
async function putAll(tx: Tx, uid: string, writes: readonly InstallWrite[]): Promise<Map<SC, number>> {
  const written = new Map<SC, number>();
  const count = (c: SC) => written.set(c, (written.get(c) ?? 0) + 1);
  for (const w of writes) {
    const path = docPath(uid, w);
    const prior = await tx.get<Record<string, unknown>>(path);
    if (prior === null) {
      tx.create(path, w.doc);
      count(w.collection);
    } else if (!sameRecord(prior.data, w.doc as unknown as Record<string, unknown>)) {
      tx.update(path, w.doc);
      count(w.collection);
    }
  }
  return written;
}

/** Q28 pages by document ID (no new index: ruling F-9), filtered in code, at most `max` kept rows. */
async function allPages<T>(store: StorePort, uid: string, collection: string, keep: (row: T) => boolean, max: number): Promise<{ id: ID; data: T }[]> {
  const out: { id: ID; data: T }[] = [];
  let after: string | null = null;
  while (out.length < max) {
    const rows: StoredDoc<T>[] = await store.query<T>(uid, {
      collection,
      where: after === null ? [] : [{ field: "__name__", op: ">", value: after }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: 100,
    });
    out.push(...rows.filter((r) => keep(r.data)).map((r) => ({ id: r.id, data: r.data })));
    if (rows.length < 100) break;
    after = rows[rows.length - 1]!.id;
  }
  return out.slice(0, max);
}

interface SessionView {
  sessionId: ID;
  requestTurns: { id: ID; turn: Turn }[];
  others: { id: ID; turn: Turn }[];
  /** False when the read stopped at TURNS_READ_MAX before the Session's newest turn (review 028 finding 6). */
  complete: boolean;
}

/** The most turns the floor reads from the request's Session; past it the manifest is not complete. */
export const TURNS_READ_MAX = 1_000;

async function readSession(store: StorePort, uid: string, job: Job): Promise<SessionView> {
  const sessionId = job.sourceIds[0]!;
  const requestIds = new Set<string>(forgetOf(job).requestTurnIds);
  // Page by page (Q14 runs ascending only), so the request is found in a long Session (review 028 finding 6).
  const rows: StoredDoc<Turn>[] = [];
  let complete = false;
  while (rows.length < TURNS_READ_MAX) {
    const last = rows[rows.length - 1];
    const page = await store.query<Turn>(uid, {
      collection: paths.turns(uid, sessionId),
      where: last === undefined ? [] : [{ field: "seq", op: ">", value: last.data.seq }],
      orderBy: { field: "seq", dir: "asc" },
      limit: TURNS_PAGE,
    });
    rows.push(...page);
    if (page.length < TURNS_PAGE) {
      complete = true;
      break;
    }
  }
  const user = rows.filter((r) => r.data.role === "user");
  return {
    sessionId,
    requestTurns: user.filter((r) => requestIds.has(r.id)).map((r) => ({ id: r.id, turn: r.data })),
    others: user.filter((r) => !requestIds.has(r.id) && r.data.state !== "dead").map((r) => ({ id: r.id, turn: r.data })),
    complete,
  };
}

async function readEvidence(store: StorePort, uid: string, eids: Iterable<ID>): Promise<Map<ID, Evidence>> {
  const out = new Map<ID, Evidence>();
  for (const eid of new Set(eids)) {
    const doc = await store.get<Evidence>(uid, paths.evidence(uid, eid));
    if (doc !== null) out.set(eid, doc.data);
  }
  return out;
}

type CloseCall = ForgetPayload["closeCalls"][number];

/** Asks the port to hang up each call not yet confirmed closed; anything but `closed` (a throw included) stays open. */
export async function askClose(closer: CallClosePort, store: StorePort, uid: string, calls: readonly CloseCall[]): Promise<CloseCall[]> {
  const out: CloseCall[] = [];
  for (const c of calls) {
    if (c.state === "closed") {
      out.push(c);
      continue;
    }
    const s = await store.get<Session>(uid, paths.session(uid, c.sessionId));
    const callIds = s === null ? [] : [...new Set([...(s.data.callId === null ? [] : [s.data.callId]), ...s.data.registeredCallIds])];
    let answer: "closed" | "failed" | undefined;
    try {
      answer = await closer.close({ sessionId: c.sessionId, callIds });
    } catch {
      answer = undefined;
    }
    out.push({ sessionId: c.sessionId, state: answer === "closed" ? "closed" : answer === "failed" ? "failed" : "pending" });
  }
  return out;
}

async function runClose(deps: ForgetDeps, uid: string, jobId: ID, lease: Lease, now: string): Promise<Job> {
  const live = await allPages<Session>(
    deps.store,
    uid,
    paths.collection(uid, "sessions"),
    (s) => (SESSION_STATUSES_WITH_CALLS as readonly string[]).includes(s.status) && (s.callId !== null || s.registeredCallIds.length > 0),
    16,
  );
  const calls = await askClose(deps.closer ?? NO_CALL_CLOSE, deps.store, uid, live.map((r) => ({ sessionId: r.id, state: "pending" as const })));
  return commitStep(deps.store, uid, jobId, lease, async (tx, job, epoch) => {
    barrierAt(tx, epoch, "resolve", now);
    return withPhase(job, nextForgetPhase("close"), now, { closeCalls: calls.slice(0, 16) });
  });
}

async function runResolve(deps: ForgetDeps, uid: string, jobId: ID, lease: Lease, job: Job, now: string): Promise<Job> {
  const f = forgetOf(job);
  const view = await readSession(deps.store, uid, job);
  const requestText = view.requestTurns.map((t) => t.turn.text ?? "").join(" ").trim();
  const first = view.requestTurns[0];
  const request: Span = {
    eid: first?.turn.evidenceId ?? f.requestTurnIds[0] ?? f.opId,
    fieldPath: "text",
    start: 0,
    end: Math.min(requestText.length, 512),
    quote: requestText.slice(0, 512),
  };
  const turns: ResolveTurn[] = view.others.map((t) => ({
    itemId: t.turn.itemIds[0] ?? t.id,
    seq: t.turn.seq,
    eid: t.turn.evidenceId,
    text: t.turn.text === null ? null : t.turn.text.slice(0, 1500),
    state: t.turn.parseState === "committed" ? "ready" : t.turn.parseState === "pending" ? "pending" : "missing",
  }));
  const memories = await allPages<Memory>(deps.store, uid, paths.collection(uid, "memories"), () => true, 201);
  const rules = (await deps.store.get<CoreRules>(uid, paths.core(uid, "rules")))?.data;
  if (rules === undefined) throw new Error("core/rules is missing");
  const scanned = resolveInput({ request, requestText, turns, memories: memories.map((m) => ({ id: m.id, memory: m.data })), rules });
  // A Session read that stopped at its cap is not a complete manifest, so the answer holds and asks.
  const manifest = { ...scanned, complete: scanned.complete && view.complete };
  const output = await deps.resolver.resolve(manifest.input);
  const evidence = await readEvidence(deps.store, uid, [...turns.flatMap((t) => (t.eid === null ? [] : [t.eid])), ...manifest.input.candidates.flatMap((c) => c.roots.map((r) => r.eid))]);
  const before = view.others.filter((t) => first !== undefined && msFromTs(t.turn.committedAt) <= msFromTs(first.turn.committedAt)).at(-1);
  const fragmentGapMs = first !== undefined && before !== undefined ? msFromTs(first.turn.committedAt) - msFromTs(before.turn.committedAt) : null;
  const resolution = checkResolve({ opId: f.opId, manifest, requestText, fragmentGapMs, evidence, output });
  return commitStep(deps.store, uid, jobId, lease, async (tx, current, epoch) => {
    if (resolution.kind === "exact") {
      for (const s of resolution.remove) {
        const id = redactOverlayId(deps.hasher, f.opId, s.eid, s.fieldPath, s);
        if ((await tx.get(paths.overlay(uid, id))) !== null) continue;
        const ev = evidence.get(s.eid)!;
        const overlay: Overlay = {
          ...cFields(uid, now, epoch.data.epoch, epoch.data.policyRev),
          opId: f.opId,
          verb: "redact",
          targetRef: { type: "evidence", id: s.eid, rev: ev.rev },
          fieldPath: s.fieldPath,
          start: s.start,
          end: s.end,
          replacementRef: null,
          sanitizedEid: null,
          state: "active",
          minSens: "S0",
        };
        tx.create(paths.overlay(uid, id), overlay);
      }
    }
    barrierAt(tx, epoch, "install", now);
    const scopePending = resolution.kind === "scopePending";
    return withPhase(current, nextForgetPhase("resolve"), now, {
      candidateRefs: targetRefs(resolution).slice(0, 128),
      scopePending,
      scopePendingId: scopePending ? deps.hasher.id(["scopePending", f.opId]) : null,
      manifestComplete: manifest.complete,
    });
  });
}

async function runInstall(deps: ForgetDeps, uid: string, jobId: ID, lease: Lease, job: Job, now: string): Promise<Job | "limit"> {
  const f = forgetOf(job);
  const store = deps.store;
  const named: { id: ID; memory: Memory }[] = [];
  for (const ref of f.candidateRefs) {
    if (ref.type !== "memory") continue;
    const doc = await store.get<Memory>(uid, paths.memory(uid, ref.id));
    if (doc !== null) named.push({ id: ref.id, memory: doc.data });
  }
  const overlays = await allPages<Overlay>(store, uid, paths.collection(uid, "overlays"), (o) => o.opId === f.opId, 1_000);
  const rangeEids = overlays.filter((o) => o.data.verb === "redact" && o.data.targetRef.type === "evidence").map((o) => o.data.targetRef.id as ID);
  const evidence = await readEvidence(store, uid, [...rangeEids, ...named.flatMap((m) => m.memory.rootSlices.map((s) => s.eid))]);
  const remove: Span[] = f.scopePending
    ? []
    : overlays.flatMap((o) => {
        const d = o.data;
        if (d.verb !== "redact" || d.fieldPath === null || d.start === null || d.end === null) return [];
        const e = evidence.get(d.targetRef.id as ID);
        const text = e === undefined ? null : evidenceFieldText(e, d.fieldPath);
        return [{ eid: d.targetRef.id as ID, fieldPath: d.fieldPath, start: d.start, end: d.end, quote: (text ?? "").slice(d.start, d.end).slice(0, 512) }];
      });
  const effects = await allPages<Effect>(store, uid, paths.collection(uid, "effects"), (e) => e.state === "active", FORGET_EFFECTS_MAX + 1);
  if (effects.length > FORGET_EFFECTS_MAX) return "limit";
  const rules = (await store.get<CoreRules>(uid, paths.core(uid, "rules")))?.data;
  if (rules === undefined) throw new Error("core/rules is missing");
  const view = await readSession(store, uid, job);
  const plan = planInstall({
    uid,
    opId: f.opId,
    stamps: { epoch: job.epoch, policyRev: job.policyRev },
    now,
    targets: f.scopePending ? [] : named,
    review: f.scopePending ? named : [],
    remove,
    evidence,
    effects: effects.map((e) => ({ id: e.id, effect: e.data })),
    rules,
    // No entity store on this branch: a non-self rule touched by a forget goes pending (ruling F-8).
    roster: [],
    // An unread older turn may be uncommitted: a capped read counts as one (fails closed).
    uncommittedAtFence: !view.complete || view.others.some((t) => t.turn.parseState === "pending"),
    hasher: deps.hasher,
  });
  if (plan.writes.filter((w) => w.order === 3).length > FORGET_PAGE_DOCS) return "limit";
  const baseRulesRev = rules.rulesRev;
  const pages = installPages(plan.writes);
  const receiptPath = paths.ledger(uid, forgetReceiptId(f.opId, deps.hasher));
  // One page per step (brief 047: install pages interleave with everything else). The cursor names the last write of
  // the last committed page. Pages before the evidence page do not change when earlier pages commit (a write already
  // in place is skipped), so the next page is the one after the cursor's; a cursor that names no page starts again
  // from the first, which writes nothing that is already there.
  const at = pages.findIndex((p) => {
    const last = p[p.length - 1]!;
    return last.collection === f.cursor.collection && (last.collection === "core" ? f.cursor.lastId === null : last.id === f.cursor.lastId);
  });
  const k = at < 0 ? 0 : at + 1;
  const page = pages[k] ?? [];
  const final = k >= pages.length - 1;
  // Review 028 finding 8: the sanitized eids and the rules' counts come from the plan whose evidence page committed;
  // the receipt's touched counts add up the writes each page really made, so a retry still counts earlier pages.
  return commitStep(store, uid, jobId, lease, async (tx, j, epoch) => {
    // Review 028 finding 7: a hard rule written since install read core/rules is never overwritten.
    const coreWrite = page.find((w) => w.collection === "core");
    if (coreWrite !== undefined) {
      const cur = await tx.get<CoreRules>(paths.core(uid, "rules"));
      if (cur === null || (cur.data.rulesRev !== baseRulesRev && !sameRecord(cur.data as unknown as Record<string, unknown>, coreWrite.doc as unknown as Record<string, unknown>))) throw new RulesMoved();
    }
    const receipt = await tx.get<Ledger>(receiptPath);
    const written = await putAll(tx, uid, page);
    if (receipt !== null && receipt.data.kind === "forgetReceipt") {
      const payload = receiptPayload(f.opId, plan, f.scopePending);
      tx.update(receipt.path, { ...receipt.data, updatedAt: now, payload: { ...payload, touched: addTouched(receipt.data.payload.touched, written) } });
    }
    if (!final) {
      const last = page[page.length - 1]!;
      return withPhase(j, "install", now, { cursor: { collection: last.collection, lastId: last.collection === "core" ? null : last.id } });
    }
    barrierAt(tx, epoch, "closure", now);
    return withPhase(j, nextForgetPhase("install"), now, {
      blockedKeys: plan.blockedKeys.slice(0, 128),
      stagedSanitizedEids: plan.sanitizedEids.slice(0, 128),
      cursor: { collection: "memories", lastId: null },
    });
  });
}

/**
 * RED-RUN SCAFFOLD (brief 047): closure does nothing, resume releases the barrier, purge does nothing. This is
 * "install as it stands today, then release", the target the No Resurrection property must first fail against.
 */
async function runClosure(deps: ForgetDeps, uid: string, jobId: ID, lease: Lease, now: string): Promise<Job> {
  return commitStep(deps.store, uid, jobId, lease, async (tx, job, epoch) => {
    barrierAt(tx, epoch, "resume", now);
    return withPhase(job, nextForgetPhase("closure"), now);
  });
}

async function runResume(deps: ForgetDeps, uid: string, jobId: ID, lease: Lease, now: string): Promise<Job> {
  return commitStep(deps.store, uid, jobId, lease, async (tx, job, epoch) => {
    const r = releaseBarrier(epoch.data, forgetOf(job).opId, now);
    if (r.kind !== "notOwner") tx.update(epoch.path, r.epoch);
    return withPhase(job, nextForgetPhase("resume"), now);
  });
}

async function runPurge(deps: ForgetDeps, uid: string, jobId: ID, lease: Lease, now: string): Promise<Job> {
  return commitStep(deps.store, uid, jobId, lease, async (_tx, job) => ({ ...withPhase(job, nextForgetPhase("purge"), now), status: "complete", leaseToken: null, leaseUntil: null }), false);
}

/** Receipt touched rows plus this page's real writes, at most 32 rows (contracts §1). */
function addTouched(prior: readonly { collection: SC; count: number }[], written: ReadonlyMap<SC, number>): { collection: SC; count: number }[] {
  const out = new Map(prior.map((t) => [t.collection, t.count] as const));
  for (const [c, n] of written) out.set(c, (out.get(c) ?? 0) + n);
  return [...out].map(([collection, count]) => ({ collection, count })).slice(0, 32);
}

async function settleJob(store: StorePort, uid: string, jobId: ID, lease: Lease, patch: (job: Job) => Job): Promise<void> {
  await store.transaction(uid, async (tx) => {
    const doc = await tx.get<Job>(paths.job(uid, jobId));
    if (doc === null || doc.data.leaseToken !== lease.token || doc.data.generation !== lease.generation) return;
    tx.update(doc.path, patch(doc.data));
  });
}

/**
 * Q18 for a forget job: a lease that expired (its worker died mid-step) goes back to `retry`, so the next claim
 * re-runs the step whose commit never landed. Returns true when it requeued the job.
 */
export async function requeueExpiredForget(store: StorePort, uid: string, jobId: ID, opsNow: number): Promise<boolean> {
  const now = tsFromMs(opsNow);
  return store.transaction(uid, async (tx) => {
    const doc = await tx.get<Job>(paths.job(uid, jobId));
    if (doc === null || doc.data.kind !== "forget" || doc.data.status !== "leased" || doc.data.leaseUntil === null || msFromTs(doc.data.leaseUntil) > opsNow) return false;
    tx.update(doc.path, { ...doc.data, status: "retry", leaseToken: null, leaseUntil: null, nextAttemptAt: now, updatedAt: now });
    return true;
  });
}

export interface AdvanceOptions {
  /** Commit at most this many steps (a phase, or one page), then hand the job back `queued`. Unbounded when absent. */
  maxSteps?: number;
  /** Hand the job back `queued` on reaching this phase, before running it. */
  until?: ForgetPhase;
}

/**
 * Leases the forget job and runs it to `done`, or as far as it gets. Resumable: each step commits with the job, and
 * a retry starts from the committed phase and cursor.
 */
export async function advanceForget(deps: ForgetDeps, uid: string, jobId: ID, opsNow: number, opts: AdvanceOptions = {}): Promise<AdvanceResult> {
  const claimed = await claimJob(deps.store, uid, jobId, opsNow, deps.hasher, FORGET_LEASE_MS);
  if (claimed === null) return { kind: "notClaimed" };
  const lease = { token: claimed.token, generation: claimed.generation };
  const now = tsFromMs(opsNow);
  const block = async (error: Job["error"]) =>
    settleJob(deps.store, uid, jobId, lease, (j) => ({ ...j, status: "blocked", error, leaseToken: null, leaseUntil: null, updatedAt: now }));
  if (claimed.job.payload.kind !== "forget") {
    await block("CONFIG");
    return { kind: "blocked", reason: "notForget" };
  }
  let job = claimed.job;
  let steps = 0;
  try {
    for (;;) {
      const phase = forgetOf(job).phase;
      if (phase === "done") return { kind: "done" };
      if (!forgetPhaseRuns(phase)) {
        await block(null);
        return { kind: "blocked", reason: "phase" };
      }
      if ((opts.maxSteps !== undefined && steps >= opts.maxSteps) || opts.until === phase) {
        await settleJob(deps.store, uid, jobId, lease, (j) => ({ ...j, status: "queued", nextAttemptAt: now, leaseToken: null, leaseUntil: null, updatedAt: now }));
        return { kind: "paused", phase };
      }
      steps++;
      if (phase === "close") job = await runClose(deps, uid, jobId, lease, now);
      else if (phase === "resolve") job = await runResolve(deps, uid, jobId, lease, job, now);
      else if (phase === "install") {
        const r = await runInstall(deps, uid, jobId, lease, job, now);
        if (r === "limit") {
          await block("LIMIT");
          return { kind: "blocked", reason: "limit" };
        }
        job = r;
      } else if (phase === "closure") job = await runClosure(deps, uid, jobId, lease, now);
      else if (phase === "resume") job = await runResume(deps, uid, jobId, lease, now);
      else job = await runPurge(deps, uid, jobId, lease, now);
    }
  } catch (error) {
    if (error instanceof LostLease) return { kind: "lostLease" };
    if (error instanceof BarrierGone) {
      await block("BARRIER");
      return { kind: "blocked", reason: "barrier" };
    }
    const phase = forgetOf(job).phase;
    await settleJob(deps.store, uid, jobId, lease, (j) => ({
      ...j,
      status: "retry",
      error: "DEPENDENCY",
      attempts: j.attempts + 1,
      nextAttemptAt: tsFromMs(opsNow + FORGET_RETRY_MS),
      leaseToken: null,
      leaseUntil: null,
      updatedAt: now,
    }));
    return { kind: "retry", phase };
  }
}
