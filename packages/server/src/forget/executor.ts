/**
 * The forget executor (spec §8 steps 3 to 8; contracts §8; briefs 021 and 047). `advanceForget` leases one forget job and
 * runs its phases in order, each committed with the job's new phase and cursor in one transaction that rechecks the
 * lease and the barrier, so a lost lease commits nothing and a retry resumes where the last commit left off:
 *
 *   close   records every registered call in `closeCalls` and asks the `CallClosePort` to hang it up (ruling 7);
 *   resolve builds the ForgetResolveV1 input, asks the port, checks the answer in code, stores the manifest
 *           (`candidateRefs`, `scopePending`) and writes a redact overlay for each verified range (ruling F-7);
 *   install writes `planInstall`'s pages: blocks and overlays, then the named Memories and effects, then the
 *           sanitized Evidence and `core/rules` in one page;
 *   closure withdraws the derivatives and restamps the survivors, page by page, then promotes a queued op;
 *   resume  clears the barrier only when ruling 6 holds, and stores the ack and the carried turns;
 *   purge   removes the forgotten text, page by page, then sets `cleanupCompleteAt`.
 *
 * Each of the last three is documented at its function. No route calls this code.
 */
import {
  type Block,
  CARRY_TURNS_MAX,
  type ClosureWrite,
  type ClockPair,
  type CoreBundle,
  type CoreEpoch,
  type CoreRules,
  type CoreState,
  type Effect,
  type Evidence,
  FORGET_PAGE_DOCS,
  type ForgetAck,
  type ForgetPhase,
  type Hasher,
  type Head,
  type ID,
  type InstallWrite,
  type Job,
  type Ledger,
  type Memory,
  type Moment,
  type Overlay,
  type PurgeWrite,
  type SC,
  type ResolveTurn,
  type Session,
  type Span,
  type Turn,
  bundleAfter,
  canonicalJSON,
  checkResolve,
  closurePages,
  evidenceFieldText,
  forgetAck,
  forgetPhaseRuns,
  installPages,
  livePair,
  maxSens,
  msFromTs,
  nextForgetPhase,
  planClosure,
  planInstall,
  planPurge,
  purgeKey,
  receiptPayload,
  redactOverlayId,
  releaseBarrier,
  resolveInput,
  resumeDecision,
  targetRefs,
  tsFromMs,
  utf8,
  walkDerivatives,
  withForgetJobDefaults,
} from "@franki/core";
import { ownerClock } from "../core-docs";
import { buildHead } from "../head-build";
import { cFields } from "../records";
import { DECK_TTL_MS } from "../sessions";
import { paths } from "../store/paths";
import { type StorePort, type StoredDoc, type Tx, readSnapshot } from "../store/port";
import { claimJob, forgetJob } from "../worker/jobs";
import { type CallClosePort, NO_CALL_CLOSE } from "./close-port";
import { forgetJobId, forgetReceiptId } from "./fence";
import type { ForgetResolvePort } from "./resolve-port";
// Brief 049 part A.
import { dropAllErrands, dropErrandsInTx, errandsToDrop } from "../errands/forget";

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
const forgetOf = (job: Job): ForgetPayload => withForgetJobDefaults(job.payload as ForgetPayload);

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
  // Brief 049 ruling 14: every Errand ends here, under the barrier, before the fresh call opens. Review fix R12: all
  // of them, a chunk per transaction; whatever a last read still finds goes in the step's own transaction.
  await dropAllErrands(deps.store, uid, now);
  const errandIds = await errandsToDrop(deps.store, uid);
  return commitStep(deps.store, uid, jobId, lease, async (tx, job, epoch) => {
    await dropErrandsInTx(tx, uid, errandIds, now);
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

/** A row a step read moved before its page committed: the page commits nothing and the job retries. */
class RowMoved extends Error {}

/** The most rows of one collection closure and purge read in the floor; past it the job stops `blocked` with LIMIT. */
export const FORGET_READ_MAX = 10_000;
/** The most Sessions closure reads turns from. */
export const FORGET_SESSIONS_MAX = 256;

interface Row<T> {
  id: ID;
  data: T;
}

interface WorldRows {
  memories: Row<Memory>[];
  evidence: Row<Evidence>[];
  effects: Row<Effect>[];
  moments: Row<Moment>[];
  sessions: Row<Session>[];
  turns: { sessionId: ID; id: ID; data: Turn }[];
  overlays: Row<Overlay>[];
  blocks: Row<Block>[];
}

async function capped<T>(store: StorePort, uid: string, collection: Parameters<typeof paths.collection>[1], max: number): Promise<Row<T>[] | "limit"> {
  const rows = await allPages<T>(store, uid, paths.collection(uid, collection), () => true, max + 1);
  return rows.length > max ? "limit" : rows;
}

async function sessionTurns(store: StorePort, uid: string, sessionId: ID): Promise<{ sessionId: ID; id: ID; data: Turn }[] | "limit"> {
  const out: { sessionId: ID; id: ID; data: Turn }[] = [];
  let after: number | null = null;
  for (;;) {
    const page: StoredDoc<Turn>[] = await store.query<Turn>(uid, {
      collection: paths.turns(uid, sessionId),
      where: after === null ? [] : [{ field: "seq", op: ">", value: after }],
      orderBy: { field: "seq", dir: "asc" },
      limit: TURNS_PAGE,
    });
    out.push(...page.map((r) => ({ sessionId, id: r.id as ID, data: r.data })));
    if (page.length < TURNS_PAGE) return out;
    if (out.length >= TURNS_READ_MAX) return "limit";
    after = page[page.length - 1]!.data.seq;
  }
}

/** Every row closure and purge read: maintenance, never through `eligible` (ruling 3). */
async function readWorld(store: StorePort, uid: string): Promise<WorldRows | "limit"> {
  const memories = await capped<Memory>(store, uid, "memories", FORGET_READ_MAX);
  const evidence = await capped<Evidence>(store, uid, "evidence", FORGET_READ_MAX);
  const effects = await capped<Effect>(store, uid, "effects", FORGET_READ_MAX);
  const moments = await capped<Moment>(store, uid, "moments", FORGET_READ_MAX);
  const sessions = await capped<Session>(store, uid, "sessions", FORGET_SESSIONS_MAX);
  const overlays = await capped<Overlay>(store, uid, "overlays", FORGET_READ_MAX);
  const blocks = await capped<Block>(store, uid, "blocks", FORGET_READ_MAX);
  if (memories === "limit" || evidence === "limit" || effects === "limit" || moments === "limit" || sessions === "limit" || overlays === "limit" || blocks === "limit") return "limit";
  const turns: WorldRows["turns"] = [];
  for (const s of sessions) {
    const t = await sessionTurns(store, uid, s.id);
    if (t === "limit") return "limit";
    turns.push(...t);
  }
  return { memories, evidence, effects, moments, sessions, turns, overlays, blocks };
}

/** The Evidence this op blocked: install's ranged Evidence (its redact overlays) and the request turns' own Evidence. */
function opBlockedEids(f: ForgetPayload, sessionId: ID, w: Pick<WorldRows, "overlays" | "evidence" | "turns">): { ranged: ID[]; request: ID[] } {
  const ranged = [...new Set(w.overlays.filter((o) => o.data.opId === f.opId && o.data.verb === "redact" && o.data.targetRef.type === "evidence").map((o) => o.data.targetRef.id as ID))];
  const requestTurns = new Set<string>(f.requestTurnIds);
  const request = new Set<ID>(f.requestEids);
  for (const t of w.turns) if (t.sessionId === sessionId && requestTurns.has(t.id) && t.data.evidenceId !== null) request.add(t.data.evidenceId);
  // A turn's Evidence may not name its Session; the request turn's ID is enough (fails closed: more is removed).
  for (const e of w.evidence) if ((e.data.sessionId === sessionId || e.data.sessionId === null) && e.data.turnId !== null && requestTurns.has(e.data.turnId) && e.data.kind === "turn") request.add(e.id);
  return { ranged, request: [...request] };
}

const targetIdsOf = (f: ForgetPayload): ID[] => (f.scopePending ? [] : f.candidateRefs.filter((r) => r.type === "memory").map((r) => r.id as ID));

/** The request Evidence of every forget queued behind the barrier (closure leaves it to that op). */
function queuedEidsOf(epoch: CoreEpoch | undefined, w: Pick<WorldRows, "evidence" | "turns">): ID[] {
  const turnIds = new Set<string>((epoch?.barrier?.queuedOps ?? []).flatMap((q) => q.requestTurnIds));
  const out = new Set<ID>();
  for (const t of w.turns) if (turnIds.has(t.id) && t.data.evidenceId !== null) out.add(t.data.evidenceId);
  for (const e of w.evidence) if (e.data.kind === "turn" && e.data.turnId !== null && turnIds.has(e.data.turnId)) out.add(e.id);
  return [...out];
}

function closureInput(f: ForgetPayload, sessionId: ID, w: WorldRows, stamps: { epoch: number; policyRev: number }, now: string, hasher: Hasher, epoch?: CoreEpoch) {
  const blocked = opBlockedEids(f, sessionId, w);
  return {
    queuedEids: queuedEidsOf(epoch, w),
    opId: f.opId,
    stamps,
    now,
    hasher,
    targetIds: targetIdsOf(f),
    blockedEids: [...blocked.ranged, ...blocked.request],
    blockedKeys: f.blockedKeys,
    providerBlocks: w.blocks.filter((b) => b.data.kind === "provider" && b.data.state === "active" && b.data.providerKey !== null).map((b) => ({ providerKey: b.data.providerKey!, allowedEvidenceId: b.data.allowedEvidenceId })),
    requestTurns: f.requestTurnIds.map((id) => ({ sessionId, id })),
    memories: w.memories.map((r) => ({ id: r.id, memory: r.data })),
    evidence: w.evidence.map((r) => ({ id: r.id, evidence: r.data })),
    effects: w.effects.map((r) => ({ id: r.id, effect: r.data })),
    moments: w.moments.map((r) => ({ id: r.id, moment: r.data })),
    turns: w.turns.map((t) => ({ sessionId: t.sessionId, id: t.id, turn: t.data })),
    sessions: w.sessions.map((r) => ({ id: r.id, session: r.data })),
  };
}

const writePath = (uid: string, w: ClosureWrite | PurgeWrite): string => {
  switch (w.collection) {
    case "memories":
      return paths.memory(uid, w.id);
    case "effects":
      return paths.effect(uid, w.id);
    case "moments":
      return paths.moment(uid, w.id);
    case "evidence":
      return paths.evidence(uid, w.id);
    case "turns":
      return paths.turn(uid, w.sessionId, w.id);
    case "sessions":
      return paths.session(uid, w.id);
  }
};

/** Equal apart from the store-owned `rev` and the times of the write. */
const sameContent = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const strip = ({ rev: _r, updatedAt: _u, createdAt: _c, ...rest }: Record<string, unknown>) => rest;
  return canonicalJSON(strip(a)) === canonicalJSON(strip(b));
};

/** The doc a write puts in place over `prior`: a hold keeps its first `createdAt` and the higher `minSens` (F-11). */
function merged(w: ClosureWrite | PurgeWrite, prior: Record<string, unknown> | null): Record<string, unknown> {
  const doc = { ...(w.doc as unknown as Record<string, unknown>) };
  if (prior === null) return doc;
  doc.createdAt = prior.createdAt;
  if (w.collection === "effects" && w.doc.kind === "withdrawnHold" && typeof prior.minSens === "string") doc.minSens = maxSens(prior.minSens as Effect["minSens"], w.doc.minSens);
  return doc;
}

type Read = Map<string, Record<string, unknown>>;
const readIndex = (uid: string, w: WorldRows | Pick<WorldRows, "memories" | "evidence" | "turns">): Read => {
  const m: Read = new Map();
  for (const r of w.memories) m.set(paths.memory(uid, r.id), r.data as unknown as Record<string, unknown>);
  for (const r of w.evidence) m.set(paths.evidence(uid, r.id), r.data as unknown as Record<string, unknown>);
  for (const t of w.turns) m.set(paths.turn(uid, t.sessionId, t.id), t.data as unknown as Record<string, unknown>);
  if ("effects" in w) {
    for (const r of w.effects) m.set(paths.effect(uid, r.id), r.data as unknown as Record<string, unknown>);
    for (const r of w.moments) m.set(paths.moment(uid, r.id), r.data as unknown as Record<string, unknown>);
    for (const r of w.sessions) m.set(paths.session(uid, r.id), r.data as unknown as Record<string, unknown>);
  }
  return m;
};

const pending = (uid: string, read: Read, w: ClosureWrite | PurgeWrite): boolean => {
  const prior = read.get(writePath(uid, w)) ?? null;
  return prior === null || !sameContent(prior, merged(w, prior));
};

/** Applies a page: every row must be as read (else RowMoved), and a write already in place is skipped. */
async function applyPage(tx: Tx, uid: string, read: Read, page: readonly (ClosureWrite | PurgeWrite)[]): Promise<Map<SC, number>> {
  const written = new Map<SC, number>();
  for (const w of page) {
    const path = writePath(uid, w);
    const seen = read.get(path) ?? null;
    const cur = await tx.get<Record<string, unknown>>(path);
    if ((cur?.data.rev ?? null) !== (seen?.rev ?? null)) throw new RowMoved();
    const doc = merged(w, cur?.data ?? null);
    if (cur === null) tx.create(path, doc);
    else if (!sameContent(cur.data, doc)) tx.update(path, doc);
    else continue;
    written.set(w.collection, (written.get(w.collection) ?? 0) + 1);
  }
  return written;
}

/**
 * Hands the barrier to the first queued op (ruling 6, brief 047 "queue promotion"): `releaseBarrier` in this
 * transaction raises the epoch for it, and its job, receipt and burned bundle are written here, as the fence writes
 * them for an op that was not queued. Returns the promoted op, or null when the queue was empty.
 */
async function promoteQueued(tx: Tx, uid: string, epoch: { path: string; data: CoreEpoch }, opId: ID, opsNow: number, hasher: Hasher, fallbackSessionId: ID): Promise<ID | null> {
  const now = tsFromMs(opsNow);
  const r = releaseBarrier(epoch.data, opId, now);
  if (r.kind !== "promoted") return null;
  const q = epoch.data.barrier!.queuedOps[0]!;
  // A queued op that lost its Session (no requestRef) runs against the promoting op's Session: its resolve finds no
  // request there, so it asks rather than guesses (fails closed; Rulings needed).
  const sessionId = (q.requestRef?.type === "session" ? q.requestRef.id : fallbackSessionId) as ID;
  const stamps = { epoch: r.epoch.epoch, policyRev: r.epoch.policyRev };
  tx.update(epoch.path, r.epoch);
  const jobPath = paths.job(uid, forgetJobId(r.opId, hasher));
  const deadItems: { sessionId: ID; itemId: string }[] = [];
  for (const turnId of q.requestTurnIds) {
    const t = await tx.get<Turn>(paths.turn(uid, sessionId, turnId));
    if (t !== null) for (const itemId of t.data.itemIds) deadItems.push({ sessionId, itemId });
  }
  if ((await tx.get(jobPath)) === null) {
    tx.create(jobPath, forgetJob({ uid, now: opsNow, ...stamps, opId: r.opId, sessionId, requestTurnIds: [...q.requestTurnIds], deadItems }));
  }
  const receiptPath = paths.ledger(uid, forgetReceiptId(r.opId, hasher));
  if ((await tx.get(receiptPath)) === null) {
    const receipt: Ledger = { ...cFields(uid, now, stamps.epoch, stamps.policyRev), kind: "forgetReceipt", state: "pending", at: now, retainUntil: null, payload: receiptPayload(r.opId, null, false) };
    tx.create(receiptPath, receipt);
  }
  const bundleDoc = await tx.get<CoreBundle>(paths.core(uid, "bundle"));
  if (bundleDoc !== null) {
    const b = bundleDoc.data;
    tx.update(bundleDoc.path, { ...b, ...stamps, state: bundleAfter(b.state, "burned"), bundleRev: b.bundleRev + 1, head: null, headHash: null, selectedRefs: [], updatedAt: now });
  }
  return r.opId;
}

/**
 * Closure (spec §8 step 6). Each step re-reads the store, plans the whole closure (`planClosure`), drops the writes
 * already in place, and commits the first page of what is left (whole groups, at most FORGET_PAGE_DOCS writes). A
 * lost lease or a moved row commits nothing; the re-run plans the same writes and skips the ones that landed. The
 * step that finds nothing left records the withdrawn count, promotes a queued op (if any) and moves to resume.
 */
async function runClosure(deps: ForgetDeps, uid: string, jobId: ID, lease: Lease, job: Job, opsNow: number): Promise<Job | "limit"> {
  const now = tsFromMs(opsNow);
  const f = forgetOf(job);
  const sessionId = job.sourceIds[0]!;
  const w = await readWorld(deps.store, uid);
  if (w === "limit") return "limit";
  const epochDoc = (await deps.store.get<CoreEpoch>(uid, paths.core(uid, "epoch")))?.data;
  if (epochDoc === undefined) throw new BarrierGone();
  const stamps = { epoch: epochDoc.epoch, policyRev: epochDoc.policyRev };
  const requestEids = opBlockedEids(f, sessionId, w).request.slice(0, 8);
  const plan = planClosure(closureInput(f, sessionId, w, stamps, now, deps.hasher, epochDoc));
  const read = readIndex(uid, w);
  const left = plan.groups.filter((g) => g.writes.some((x) => pending(uid, read, x)));
  const page = closurePages(left, FORGET_PAGE_DOCS)[0] ?? [];
  const receiptPath = paths.ledger(uid, forgetReceiptId(f.opId, deps.hasher));
  return commitStep(deps.store, uid, jobId, lease, async (tx, j, epoch) => {
    if (epoch.data.epoch !== stamps.epoch) throw new RowMoved();
    const receipt = await tx.get<Ledger>(receiptPath);
    if (page.length > 0) {
      const written = await applyPage(tx, uid, read, page);
      if (receipt !== null && receipt.data.kind === "forgetReceipt") {
        tx.update(receipt.path, { ...receipt.data, updatedAt: now, payload: { ...receipt.data.payload, touched: addTouched(receipt.data.payload.touched, written) } });
      }
      const last = page[page.length - 1]!;
      return withPhase(j, "closure", now, { requestEids, cursor: { collection: last.collection, lastId: last.id } });
    }
    if (receipt !== null && receipt.data.kind === "forgetReceipt") {
      tx.update(receipt.path, { ...receipt.data, updatedAt: now, payload: { ...receipt.data.payload, withdrawnCount: plan.withdrawnIds.length } });
    }
    const handedTo = await promoteQueued(tx, uid, epoch, f.opId, opsNow, deps.hasher, sessionId);
    if (handedTo === null) barrierAt(tx, epoch, "resume", now);
    return withPhase(j, nextForgetPhase("closure"), now, { handedTo, requestEids, cursor: { collection: "evidence", lastId: null } });
  });
}

/** True when closure, re-planned on the store as it is now, has nothing left to write (ruling 6). */
async function closureSettled(deps: ForgetDeps, uid: string, job: Job, stamps: { epoch: number; policyRev: number }, now: string): Promise<{ finished: boolean; restamped: boolean } | "limit"> {
  const w = await readWorld(deps.store, uid);
  if (w === "limit") return "limit";
  const epoch = (await deps.store.get<CoreEpoch>(uid, paths.core(uid, "epoch")))?.data;
  const plan = planClosure(closureInput(forgetOf(job), job.sourceIds[0]!, w, stamps, now, deps.hasher, epoch));
  const read = readIndex(uid, w);
  const left = plan.groups.filter((g) => g.writes.some((x) => pending(uid, read, x)));
  return { finished: !left.some((g) => g.order === 1), restamped: !left.some((g) => g.order === 2) };
}

/** The ack and the carried turns resume stores (ruling 8): data, not words. */
async function resumeData(deps: ForgetDeps, uid: string, job: Job): Promise<{ ack: ForgetAck; carryTurnIds: ID[]; noneCleared: boolean }> {
  const f = forgetOf(job);
  const store = deps.store;
  const view = await readSession(store, uid, job);
  const receipt = (await store.get<Ledger>(uid, paths.ledger(uid, forgetReceiptId(f.opId, deps.hasher))))?.data;
  const rules = (await store.get<CoreRules>(uid, paths.core(uid, "rules")))?.data;
  const retained = receipt !== undefined && receipt.kind === "forgetReceipt" ? receipt.payload.retainedRuleIds : [];
  const pendingRuleIds = retained.filter((id) => rules?.allergies.some((r) => r.id === id && r.state === "pending") ?? false);
  // As install computes it: an unread or uncommitted older turn means install cleared confirmed-none state.
  const noneCleared = !view.complete || view.others.some((t) => t.turn.parseState === "pending");
  const withdrawnCount = receipt !== undefined && receipt.kind === "forgetReceipt" ? receipt.payload.withdrawnCount : 0;
  const ack = forgetAck({ scopePending: f.scopePending, pendingRuleIds, withdrawnCount, noneCleared });
  // The last eligible sanitized user turns of the request's Session: a turn on retained Evidence, never the request.
  const carry: ID[] = [];
  for (const t of view.others) {
    if (t.turn.text === null || t.turn.evidenceId === null || t.turn.sourceClass === "T") continue;
    const e = await store.get<Evidence>(uid, paths.evidence(uid, t.turn.evidenceId));
    if (e === null || e.data.status !== "retained") continue;
    carry.push(t.id);
  }
  return { ack, carryTurnIds: carry.slice(-CARRY_TURNS_MAX), noneCleared };
}

type Compiled = { head: Head; rulesRev: number } | null;

/**
 * The Head a fresh call would get once this op's barrier clears (spec §8 step 7: the bundle compiled again from
 * eligible rows only), compiled by the existing `buildHead` against the cleared epoch. Null when it cannot be: the
 * barrier is not this op's, a fixture clock has no world time, or the fixed sections are over the cap. A null
 * leaves the bundle burned, and the next open compiles it (fails closed).
 */
async function compileCleared(deps: ForgetDeps, uid: string, epoch: CoreEpoch, opId: ID, opsNow: number): Promise<Compiled> {
  const r = releaseBarrier(epoch, opId, tsFromMs(opsNow));
  if (r.kind !== "cleared") return null;
  const state = (await deps.store.get<CoreState>(uid, paths.core(uid, "state")))?.data;
  const rules = (await deps.store.get<CoreRules>(uid, paths.core(uid, "rules")))?.data;
  if (state === undefined || rules === undefined) return null;
  let pair: ClockPair;
  try {
    pair = ownerClock(state, { read: () => livePair(opsNow, state.currentZone) });
  } catch {
    return null;
  }
  const out = await readSnapshot(deps.store, uid, (reader) => buildHead(reader, uid, { epoch: r.epoch, rules }, pair, 1));
  return out.ok ? { head: out.head, rulesRev: rules.rulesRev } : null;
}

async function writeBundle(tx: Tx, uid: string, compiled: Compiled, epoch: CoreEpoch, opsNow: number, hasher: Hasher): Promise<void> {
  if (compiled === null) return;
  const doc = await tx.get<CoreBundle>(paths.core(uid, "bundle"));
  const rules = await tx.get<CoreRules>(paths.core(uid, "rules"));
  // Rules that moved since the compile would make the Head stale: leave the bundle burned for the next open.
  if (doc === null || rules === null || rules.data.rulesRev !== compiled.rulesRev || doc.data.state === "blocked") return;
  const now = tsFromMs(opsNow);
  const head = compiled.head;
  tx.update(doc.path, {
    ...doc.data,
    epoch: epoch.epoch,
    policyRev: epoch.policyRev,
    state: bundleAfter(doc.data.state, "compiled"),
    bundleRev: doc.data.bundleRev + 1,
    rulesRev: compiled.rulesRev,
    head,
    headHash: hasher.sha256(utf8(head.text)),
    selectedRefs: head.selectedRefs,
    compiledAt: now,
    expiresAt: tsFromMs(opsNow + DECK_TTL_MS),
    updatedAt: now,
  });
}

type ResumeOutcome = { job: Job; wait: "calls" | "closure" | null };

/**
 * Resume (spec §8 step 7; ruling 6). It clears the barrier only when it is this op's, every call is confirmed
 * closed, closure has nothing left to write and the survivors are restamped, and the queue is empty; with a queued
 * op it promotes that op instead, and the barrier stays up. Otherwise it waits (`retry`): there is no timeout path.
 * After a hand-over at closure (`handedTo`), only the store half runs. On a clear it writes the bundle compiled
 * at the cleared epoch (`compileCleared`).
 */
async function runResume(deps: ForgetDeps, uid: string, jobId: ID, lease: Lease, job: Job, opsNow: number): Promise<ResumeOutcome | "limit"> {
  const now = tsFromMs(opsNow);
  const f = forgetOf(job);
  const receiptPath = paths.ledger(uid, forgetReceiptId(f.opId, deps.hasher));
  const data = await resumeData(deps, uid, job);
  const storeHalf = async (tx: Tx, j: Job, patch: Partial<ForgetPayload>) => {
    const receipt = await tx.get<Ledger>(receiptPath);
    if (receipt !== null && receipt.data.kind === "forgetReceipt" && receipt.data.payload.blockedAt === null) {
      tx.update(receipt.path, { ...receipt.data, updatedAt: now, payload: { ...receipt.data.payload, blockedAt: now } });
    }
    return withPhase(j, nextForgetPhase("resume"), now, { ...patch, ack: data.ack, carryTurnIds: data.carryTurnIds, cursor: { collection: "evidence", lastId: null } });
  };
  const calls = await askClose(deps.closer ?? NO_CALL_CLOSE, deps.store, uid, f.closeCalls);
  if (f.handedTo !== null) {
    // The barrier is the promoted op's now, but this op still finishes only once its own calls are confirmed closed.
    const closed = calls.every((c) => c.state === "closed");
    const j = await commitStep(deps.store, uid, jobId, lease, (tx, cur) => (closed ? storeHalf(tx, cur, { closeCalls: calls }) : Promise.resolve(withPhase(cur, "resume", now, { closeCalls: calls }))), false);
    return { job: j, wait: closed ? null : "calls" };
  }
  const epochNow = (await deps.store.get<CoreEpoch>(uid, paths.core(uid, "epoch")))?.data;
  if (epochNow === undefined) throw new BarrierGone();
  const settled = await closureSettled(deps, uid, job, { epoch: epochNow.epoch, policyRev: epochNow.policyRev }, now);
  if (settled === "limit") return "limit";
  const compiled = await compileCleared(deps, uid, epochNow, f.opId, opsNow);
  let wait: ResumeOutcome["wait"] = null;
  const next = await commitStep(deps.store, uid, jobId, lease, async (tx, j, epoch) => {
    if (epoch.data.epoch !== epochNow.epoch) throw new RowMoved();
    const decision = resumeDecision({
      barrierIsThisOp: epoch.data.barrier?.opId === f.opId,
      callsClosed: calls.every((c) => c.state === "closed"),
      closureFinished: settled.finished,
      survivorsRestamped: settled.restamped,
      queueEmpty: (epoch.data.barrier?.queuedOps.length ?? 0) === 0,
    });
    if (decision.kind === "wait") {
      wait = decision.reason === "calls" ? "calls" : "closure";
      return withPhase(j, "resume", now, { closeCalls: calls });
    }
    if (decision.kind === "promote") {
      const handedTo = await promoteQueued(tx, uid, epoch, f.opId, opsNow, deps.hasher, j.sourceIds[0]!);
      return storeHalf(tx, j, { closeCalls: calls, handedTo });
    }
    const r = releaseBarrier(epoch.data, f.opId, now);
    if (r.kind !== "cleared") throw new BarrierGone();
    tx.update(epoch.path, r.epoch);
    await writeBundle(tx, uid, compiled, r.epoch, opsNow, deps.hasher);
    return storeHalf(tx, j, { closeCalls: calls });
  });
  return { job: next, wait };
}

/**
 * Purge (spec §8 step 8; ruling 9). Each step plans the removals (`planPurge`) and commits the next page after the
 * cursor; the cursor only advances. The step that finds nothing left sets `cleanupCompleteAt`, completes the
 * receipt and the job. It never runs under its own barrier (the barrier is already down or handed over).
 */
async function runPurge(deps: ForgetDeps, uid: string, jobId: ID, lease: Lease, job: Job, opsNow: number): Promise<Job | "limit"> {
  const now = tsFromMs(opsNow);
  const f = forgetOf(job);
  const sessionId = job.sourceIds[0]!;
  const store = deps.store;
  const memories = await capped<Memory>(store, uid, "memories", FORGET_READ_MAX);
  const evidence = await capped<Evidence>(store, uid, "evidence", FORGET_READ_MAX);
  const overlays = await capped<Overlay>(store, uid, "overlays", FORGET_READ_MAX);
  // Brief 048 ruling 1: Franki's withheld words may be in any Session, so purge reads every Session's turns.
  const sessions = await capped<Session>(store, uid, "sessions", FORGET_SESSIONS_MAX);
  if (memories === "limit" || evidence === "limit" || overlays === "limit" || sessions === "limit") return "limit";
  const turns: WorldRows["turns"] = [];
  for (const s of sessions) {
    const t = await sessionTurns(store, uid, s.id);
    if (t === "limit") return "limit";
    turns.push(...t);
  }
  const blocked = opBlockedEids(f, sessionId, { overlays, evidence, turns });
  const derivatives = walkDerivatives({ targetIds: targetIdsOf(f), blockedEids: [...blocked.ranged, ...blocked.request], blockedKeys: f.blockedKeys, memories: memories.map((r) => ({ id: r.id, memory: r.data })) });
  const writes = planPurge({
    now,
    blockedEids: [...blocked.ranged, ...blocked.request],
    memoryIds: [...derivatives],
    requestTurns: f.requestTurnIds.map((id) => ({ sessionId, id })),
    evidence: evidence.map((r) => ({ id: r.id, evidence: r.data })),
    memories: memories.map((r) => ({ id: r.id, memory: r.data })),
    turns: turns.map((t) => ({ sessionId: t.sessionId, id: t.id, turn: t.data })),
  });
  const at = purgeKey(f.cursor);
  const after = (x: PurgeWrite) => {
    const k = purgeKey({ collection: x.collection, lastId: x.id });
    return k[0] > at[0] || (k[0] === at[0] && k[1] > at[1]);
  };
  const page = writes.filter(after).slice(0, FORGET_PAGE_DOCS);
  const read = readIndex(uid, { memories, evidence, turns });
  const receiptPath = paths.ledger(uid, forgetReceiptId(f.opId, deps.hasher));
  return commitStep(
    store,
    uid,
    jobId,
    lease,
    async (tx, j) => {
      if (page.length > 0) {
        await applyPage(tx, uid, read, page);
        const last = page[page.length - 1]!;
        return withPhase(j, "purge", now, { cursor: { collection: last.collection, lastId: last.id } });
      }
      const receipt = await tx.get<Ledger>(receiptPath);
      if (receipt !== null && receipt.data.kind === "forgetReceipt") {
        tx.update(receipt.path, { ...receipt.data, state: "complete", updatedAt: now, payload: { ...receipt.data.payload, cleanupCompleteAt: receipt.data.payload.cleanupCompleteAt ?? now } });
      }
      return { ...withPhase(j, nextForgetPhase("purge"), now), status: "complete", leaseToken: null, leaseUntil: null };
    },
    false,
  );
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
      } else if (phase === "closure" || phase === "purge") {
        const r = phase === "closure" ? await runClosure(deps, uid, jobId, lease, job, opsNow) : await runPurge(deps, uid, jobId, lease, job, opsNow);
        if (r === "limit") {
          await block("LIMIT");
          return { kind: "blocked", reason: "limit" };
        }
        job = r;
      } else {
        const r = await runResume(deps, uid, jobId, lease, job, opsNow);
        if (r === "limit") {
          await block("LIMIT");
          return { kind: "blocked", reason: "limit" };
        }
        job = r.job;
        if (r.wait !== null) {
          // Ruling 6: no timeout path. The job waits as `retry` and asks again on its next attempt.
          await settleJob(deps.store, uid, jobId, lease, (j) => ({ ...j, status: "retry", nextAttemptAt: tsFromMs(opsNow + FORGET_RETRY_MS), leaseToken: null, leaseUntil: null, updatedAt: now }));
          return { kind: "waiting", phase: "resume", reason: r.wait };
        }
      }
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
