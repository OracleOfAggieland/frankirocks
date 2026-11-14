/**
 * Brief 049 part A, ruling 3: `start_errand` answers at once. Called by `/api/tool` in two halves.
 *
 *   1. `planErrand`, after the turn check and outside any transaction. An Errand already claimed for this Turn
 *      answers from that Errand (review fix V9: its own `about`; `started` unless it was dropped, then `stale`). Else
 *      the agents for `about` (ruling 6): none registered, `unavailable`; none ready for this owner, `notConnected`
 *      when one is only unconnected, else `unavailable`; some ready, the Errand runs with those. Then the
 *      assignment's turn IDs (ruling 2); a turn that is not the owner's own committed words answers `stale`.
 *   2. `claim`, inside the tool route's own transaction, before its first write (review fix V9: so an answer the
 *      admission holds or finds stale starts nothing). It rereads the Errand (a concurrent start may have won),
 *      counts the owner's running Errands (ruling 7; review fix R4: one older than `ERRAND_RUN_SPAN_MS`, or whose
 *      Session is no longer live, does not count) and returns the answer, plus the writes to make only once the
 *      admission issued a Permit: the Errand, its Job, one ledger row, and the Session's mark (review fix R1).
 *   3. After the commit the route schedules the run through `ctx.schedule` (ruling 4); a run that never starts is
 *      picked up by the state poll.
 *
 * The note is code-worded and S0 (`errandStartNote`).
 */
import {
  type ErrandAbout,
  type ErrandArgs,
  ERRAND_MARK_IDS_MAX,
  ERRAND_RETAIN_MS,
  ERRAND_RUNNING_MAX,
  ERRAND_RUN_SPAN_MS,
  type Errand,
  type ErrandMark,
  type ErrandStartState,
  type ID,
  type Infer,
  type Ledger,
  type Session,
  type Stamp,
  type ToolResult,
  type Turn,
  type W,
  errandStartNote,
  msFromTs,
  tsFromMs,
} from "@franki/core";
import { storeReader } from "../head-build";
import { cFields } from "../records";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { type ErrandAgent, agentsFor, errandAgentsOf } from "./agent";
import { assignmentTurnIds } from "./assignment";
import { errandIdOf, errandJob, errandLedgerId, runningErrands } from "./records";

type ErrandResult = Extract<Infer<typeof ToolResult>, { name: "start_errand" }>;

/** How long the start's note lives on the wire. */
export const ERRAND_NOTE_TTL_MS = 60_000;

async function readyAgents(ctx: RouteContext, about: readonly ErrandAbout[]): Promise<{ agents: ErrandAgent[]; state: ErrandStartState | null }> {
  const agents = agentsFor(errandAgentsOf(ctx), about);
  if (agents.length === 0) return { agents: [], state: "unavailable" };
  const checks = await Promise.all(agents.map((a) => a.available(ctx).catch(() => "unavailable" as const)));
  const ready = agents.filter((_, i) => checks[i] === "ready");
  if (ready.length > 0) return { agents: ready, state: null };
  return { agents: [], state: checks.includes("notConnected") ? "notConnected" : "unavailable" };
}

/** The claim's answer and, when it starts one, the writes to make once the admission has issued a Permit. */
export interface ErrandClaim {
  result: ErrandResult;
  /** Makes the Errand's writes in the caller's transaction; null when nothing is to be started. */
  write: ((tx: Tx) => void) | null;
  /** The Errand to schedule after the commit, when `write` ran. */
  errandId: ID | null;
}

export interface ErrandClaimAt {
  session: Session;
  epoch: number;
  policyRev: number;
  opsNow: number;
}

/** What `planErrand` decided outside the transaction: a final answer, or a claim to make inside it. */
export type ErrandPlan = { kind: "answer"; result: ErrandResult } | { kind: "claim"; result: ErrandResult; claim: (tx: Tx, at: ErrandClaimAt) => Promise<ErrandClaim> };

/** Review fix R4: running Errands that can still be running: within the run's span, and of a live Session. */
async function liveRunning(tx: Tx, uid: string, ops: number, sessionId: string): Promise<number> {
  const rows = (await runningErrands(tx, uid)).filter((r) => ops - msFromTs(r.data.startedAt) <= ERRAND_RUN_SPAN_MS);
  const live = await Promise.all(
    rows.map(async (r) => {
      if (r.data.sessionId === sessionId) return true;
      const s = (await tx.get<Session>(paths.session(uid, r.data.sessionId)))?.data ?? null;
      return s !== null && (s.status === "active" || s.status === "minting") && s.generation === r.data.generation;
    }),
  );
  return live.filter(Boolean).length;
}

export async function planErrand(ctx: RouteContext, x: { stamp: Stamp; turn: Turn; args: ErrandArgs; noteId: ID }): Promise<ErrandPlan> {
  const { uid, deps } = ctx;
  const answer = (state: ErrandStartState, about: readonly ErrandAbout[], errandId: ID | null): ErrandResult => {
    const note: W = {
      noteId: x.noteId,
      rev: 1,
      kind: "result",
      text: errandStartNote(state, about),
      rootKeys: [],
      dependsOn: [],
      sens: "S0",
      expiresAt: tsFromMs(deps.clock.read().opsClock.now + ERRAND_NOTE_TTL_MS),
      unprompted: false,
      momentId: null,
      tokens: [],
    };
    return { name: "start_errand", state, errandId, notes: [note] };
  };
  const errandId = errandIdOf(deps.hasher, x.stamp.sessionId, x.stamp.turnId);
  // Review fix V9: a repeat on this Turn answers from the Errand it already started, never from its new arguments.
  const fromExisting = (e: Errand): ErrandResult => (e.status === "dropped" ? answer("stale", e.about, null) : answer("started", e.about, errandId));
  const existing = (await deps.store.get<Errand>(uid, paths.errand(uid, errandId)))?.data ?? null;
  if (existing !== null) return { kind: "answer", result: fromExisting(existing) };
  const { agents, state } = await readyAgents(ctx, x.args.about);
  if (state !== null) return { kind: "answer", result: answer(state, x.args.about, null) };
  const about = agents.map((a) => a.about);
  const turnIds = await assignmentTurnIds(storeReader(deps.store, uid), uid, x.stamp.sessionId, x.turn, x.stamp.turnId as ID);
  if (turnIds === null) return { kind: "answer", result: answer("stale", about, null) };

  const claim = async (tx: Tx, c: ErrandClaimAt): Promise<ErrandClaim> => {
    const none = (state: ErrandStartState): ErrandClaim => ({ result: answer(state, about, null), write: null, errandId: null });
    const [again, mark] = await Promise.all([tx.get<Errand>(paths.errand(uid, errandId)), tx.get<ErrandMark>(paths.errandMark(uid, x.stamp.sessionId))]);
    // A concurrent start for the same Turn won: its run is scheduled by it.
    if (again !== null) return { result: fromExisting(again.data), write: null, errandId: null };
    if (c.session.status !== "active" && c.session.status !== "minting") return none("stale");
    // Ruling 7: the owner's running Errands, read in this transaction so two starts can't both pass the count.
    if ((await liveRunning(tx, uid, c.opsNow, x.stamp.sessionId)) >= ERRAND_RUNNING_MAX) return none("busy");
    const now = tsFromMs(c.opsNow);
    const errand: Errand = {
      ...cFields(uid, now, c.epoch, c.policyRev),
      sessionId: x.stamp.sessionId as ID,
      turnId: x.stamp.turnId as ID,
      generation: x.stamp.generation,
      about,
      agentIds: agents.map((a) => a.id),
      assignmentTurnIds: turnIds,
      status: "running",
      claimedEpoch: c.epoch,
      startedAt: now,
      readyAt: null,
      endedAt: null,
      reads: [],
      outcome: null,
      lines: [],
      offer: null,
      saidResponseId: null,
      gate: null,
      retainUntil: tsFromMs(c.opsNow + ERRAND_RETAIN_MS),
    };
    const write = (w: Tx) => {
      w.create(paths.errand(uid, errandId), errand);
      w.create(paths.job(uid, errandId), errandJob({ uid, errandId, sessionId: errand.sessionId, turnId: errand.turnId, opsNow: c.opsNow, epoch: c.epoch, policyRev: c.policyRev }));
      const row: Extract<Ledger, { kind: "errand" }> = {
        ...cFields(uid, now, c.epoch, c.policyRev),
        kind: "errand",
        state: "complete",
        at: now,
        retainUntil: null,
        payload: { errandId, sessionId: errand.sessionId, turnId: errand.turnId, about, agentIds: errand.agentIds },
      };
      w.create(paths.ledger(uid, errandLedgerId(deps.hasher, errandId)), row);
      // Review fix R1: the Session's mark names its latest Errands, so the poll reads them by ID.
      const openUntil = tsFromMs(Math.max(c.opsNow + ERRAND_RETAIN_MS, mark === null ? 0 : msFromTs(mark.data.openUntil)));
      if (mark === null) {
        w.create(paths.errandMark(uid, x.stamp.sessionId), { ...cFields(uid, now, c.epoch, c.policyRev), sessionId: x.stamp.sessionId as ID, errandIds: [errandId], openUntil } satisfies ErrandMark);
      } else {
        const ids = [...mark.data.errandIds.filter((i) => i !== errandId), errandId].slice(-ERRAND_MARK_IDS_MAX);
        w.update(mark.path, { ...mark.data, errandIds: ids, openUntil, updatedAt: now } satisfies ErrandMark);
      }
    };
    return { result: answer("started", about, errandId), write, errandId };
  };
  // The answer the model reads if the claim starts it; the claim may answer `busy` or `stale` instead.
  return { kind: "claim", result: answer("started", about, errandId), claim };
}
