/**
 * Brief 049 part A, ruling 3: `start_errand` answers at once. Called by `/api/tool` after its turn check, outside the
 * admission transaction, as the phone call is.
 *
 *   1. The agents for `about` (ruling 6). None registered: `unavailable`. None ready for this owner: `notConnected`
 *      when one is only unconnected, else `unavailable`. Some ready: the Errand runs with those.
 *   2. The assignment's turn IDs (ruling 2); a turn that is not the owner's own committed words answers `stale`.
 *   3. One transaction: an Errand already claimed for this Turn answers `started` again and schedules nothing; the
 *      Stamp and the Session must still be current and no barrier up (`stale`); with `ERRAND_RUNNING_MAX` running,
 *      `busy`; otherwise the Errand, its Job and one ledger row are created.
 *   4. After the commit, the run is scheduled through `ctx.schedule` (ruling 4); a run that never starts is picked up
 *      by the state poll (`pickUpErrands`).
 *
 * The note is code-worded and S0 (`errandStartNote`).
 */
import {
  type ErrandAbout,
  type ErrandArgs,
  ERRAND_RUNNING_MAX,
  type Errand,
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
  tsFromMs,
} from "@franki/core";
import { readCoreDocs } from "../core-docs";
import { currentStamp, sameStamp } from "../deck";
import { storeReader } from "../head-build";
import { cFields } from "../records";
import type { RouteContext } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import { type ErrandAgent, agentsFor, errandAgentsOf } from "./agent";
import { assignmentTurnIds } from "./assignment";
import { errandIdOf, errandJob, errandLedgerId, runningErrands } from "./records";
import { runErrand } from "./run";

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

export async function startErrand(ctx: RouteContext, x: { stamp: Stamp; turn: Turn; args: ErrandArgs; noteId: ID }): Promise<ErrandResult> {
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
  const { agents, state } = await readyAgents(ctx, x.args.about);
  if (state !== null) return answer(state, x.args.about, null);
  const about = agents.map((a) => a.about);
  const turnIds = await assignmentTurnIds(storeReader(deps.store, uid), uid, x.stamp.sessionId, x.turn, x.stamp.turnId as ID);
  if (turnIds === null) return answer("stale", about, null);
  const errandId = errandIdOf(deps.hasher, x.stamp.sessionId, x.stamp.turnId);

  let claimed: { state: ErrandStartState; fresh: boolean };
  try {
    claimed = await deps.store.transaction(uid, async (tx) => {
      const existing = await tx.get<Errand>(paths.errand(uid, errandId));
      if (existing !== null) return { state: "started" as const, fresh: false };
      const [session, core] = await Promise.all([tx.get<Session>(paths.session(uid, x.stamp.sessionId)), readCoreDocs(tx, uid)]);
      if (session === null || (session.data.status !== "active" && session.data.status !== "minting") || core.epoch.data.barrier !== null) return { state: "stale" as const, fresh: false };
      const current = currentStamp(x.stamp.sessionId, session.data.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data });
      if (!sameStamp(x.stamp, current)) return { state: "stale" as const, fresh: false };
      // Ruling 7: the owner's running Errands, read in this transaction so two starts can't both pass the count.
      if ((await runningErrands(tx, uid)).length >= ERRAND_RUNNING_MAX) return { state: "busy" as const, fresh: false };
      const ops = deps.clock.read().opsClock.now;
      const now = tsFromMs(ops);
      const { epoch, policyRev } = core.epoch.data;
      const errand: Errand = {
        ...cFields(uid, now, epoch, policyRev),
        sessionId: x.stamp.sessionId as ID,
        turnId: x.stamp.turnId as ID,
        generation: x.stamp.generation,
        about,
        agentIds: agents.map((a) => a.id),
        assignmentTurnIds: turnIds,
        status: "running",
        claimedEpoch: epoch,
        startedAt: now,
        readyAt: null,
        endedAt: null,
        reads: [],
        outcome: null,
        lines: [],
      };
      tx.create(paths.errand(uid, errandId), errand);
      tx.create(paths.job(uid, errandId), errandJob({ uid, errandId, sessionId: errand.sessionId, turnId: errand.turnId, opsNow: ops, epoch, policyRev }));
      const row: Extract<Ledger, { kind: "errand" }> = {
        ...cFields(uid, now, epoch, policyRev),
        kind: "errand",
        state: "complete",
        at: now,
        retainUntil: null,
        payload: { errandId, sessionId: errand.sessionId, turnId: errand.turnId, about, agentIds: errand.agentIds },
      };
      tx.create(paths.ledger(uid, errandLedgerId(deps.hasher, errandId)), row);
      return { state: "started" as const, fresh: true };
    });
  } catch (error) {
    // A concurrent start for the same Turn won the create: it is started, and its runner is scheduled by it.
    if (!isStoreError(error, "staleRevision")) throw error;
    const existing = await deps.store.get<Errand>(uid, paths.errand(uid, errandId));
    if (existing === null) throw error;
    claimed = { state: "started", fresh: false };
  }
  if (claimed.fresh) ctx.schedule(() => runErrand(ctx, errandId));
  return answer(claimed.state, about, claimed.state === "started" ? errandId : null);
}
