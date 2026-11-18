/**
 * POST /api/session/open (R11; R26.10, R26.11; KV09; design "Session open").
 *   1. Guard (runRoute), core documents, idempotency, then the bounded Q13 expiry close from `tick`.
 *   2. The extract drain raced against what is left of the open's 3,500 ms server budget after keeping 1,400 ms
 *      for steps 3 and 4; if the limit wins, open proceeds and the drain keeps running through `schedule`.
 *   3. One transaction: barrier check, compileHead over the Memories through Q28 (read from a lock-free snapshot,
 *      see below), prior Session closing, core/bundle with bundleRev + 1, the new Session (minting, generation 1,
 *      stateAck), core/epoch.activeSessionId, core/state.currentZone and the request ledger entry. The Deck,
 *      StateAck and Session.stateAck carry the post-compile bundleRev. Any failure commits nothing, so core/bundle
 *      is unchanged.
 *   4. After commit, hang up the prior Session's calls within what is left of the budget and mark it closed (a
 *      failure also writes a hangup Job, driven through `schedule`).
 *
 * The Memories and their Evidence are read through `readSnapshot`, not the transaction. An Extract_Job's commit
 * reads core/epoch and writes Memories; this transaction writes core/epoch. When this transaction also held the
 * Memories it read, the two waited on each other until one aborted (brief 005: on the emulator, a 2.2 s lock wait
 * and then ABORTED, so the retry after a lost answer failed with STALE). A Memory committed after the snapshot
 * reaches the Head at the next open, as one committed mid-call does.
 */
import {
  type CoreBundle,
  type CoreEpoch,
  type CoreState,
  type ID,
  type Infer,
  OpenRequest,
  type OpenResponse,
  idParts,
  tsFromMs,
  utf8,
} from "@franki/core";
import { raceLimit } from "../clock/timers";
import { ensureCoreDocs, ownerClock, readCoreDocs } from "../core-docs";
import { currentStamp, issueDeck } from "../deck";
import { buildHead } from "../head-build";
import { applyProposals } from "../onturn/proposals";
import { completeRequest } from "../ledger/request";
import { DECK_TTL_MS, afterClosed, beginCloseInTx, finishCloseInTx, newSession, stateAck } from "../sessions";
import { paths } from "../store/paths";
import { readSnapshot } from "../store/port";
import { openForgetPass } from "../forget/drive";
import { drainExtractJobs } from "../worker/drain";
import { driveHangupJob, hangupAll, hangupJobId } from "../worker/hangup";
import { startTick } from "../worker/tick";
import { configError } from "./errors";
import { mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";
// Brief 026: a narrowed audience carried into the fresh call, with the swap line (voice-control task 50).
import { type Proactive, type Session, turnRef } from "@franki/core";
import { admitRule } from "../admission/seam";
import { holdCarried, inheritCandidates, inheritedSession, narrowestInherited, speaksSwapLine, swapLineRule, swapLineTurnId } from "../audience-swap";
import { checkOpenVisit } from "./open-visit";
import { openingProactive } from "./delivery-wire";
// Brief 048: the forget's acknowledgment on a fresh call.
import { ackRule, ackTurnId, dueAcks, outsideTx, readAckCandidates, takeDueAck } from "../forget/ack";
// Brief 052: the first meeting's line.
import { closeMeet, meetLineOf, meetOffer, meetRule, meetTurnId, readMeetRows, recordMeetSaid } from "../meet";

/**
 * Server time for one open, from runRoute's first line to the answer. The browser gives the whole request 5 s
 * (R16.6, `OPEN_TIMEOUT_MS`) from just after it reads the ID token; 1.5 s is left for the network, Next.js and a
 * cold process's first token check and Firestore channel, which the live check showed are not small.
 */
export const OPEN_BUDGET_MS = 3_500;
/** One Firestore round trip from a laptop to us-central1, as the emulator runs add it. */
export const OPEN_ROUND_TRIP_MS = 75;
/**
 * The open's transaction, counted as `store/firestore-store.ts` makes its round trips (`open-budget.test.ts` pins it):
 * the core documents and the request entry together (1); the Sessions it may inherit from (1); the Head's snapshot,
 * its Memories, their Evidence in two waves, and the blocks and overlays (4); the paths written but never read (1);
 * the commit (1). The prior Session and the request entry are read again from what the transaction already read.
 */
export const OPEN_TX_ROUND_TRIPS = 8;
/**
 * The prior Session's close at its worst: its transaction (the Session, its hang-up Job, core/epoch, the commit: 4),
 * then `afterClosed`'s read of the Turns (1) and `ensureExtractJobs` (core/epoch with the Jobs, the Evidence, the
 * commit: 3, whatever the number of Turns; `worker/extract-jobs.test.ts` pins it).
 */
export const PRIOR_CLOSE_ROUND_TRIPS = 8;
/** How far the drain may run past its limit before its timer fires (9–10 ms on the emulator, Nov 12). */
export const DRAIN_OVERSHOOT_MS = 25;
/**
 * Kept back from the drain for the transaction and the prior Session's close: one retried transaction (two of
 * them, 2 × 8 = 16 round trips; the emulator's `collide` retry took 1,308–1,366 ms), the prior close at its worst
 * (8), and the drain's overshoot. (16 + 8) × 75 ms + 25 ms = 1,825 ms.
 */
export const OPEN_TAIL_RESERVE_MS = (2 * OPEN_TX_ROUND_TRIPS + PRIOR_CLOSE_ROUND_TRIPS) * OPEN_ROUND_TRIP_MS + DRAIN_OVERSHOOT_MS;
/** Kept back from the prior Session's hangups for its closing transaction and Extract_Jobs (500–550 ms measured). */
export const PRIOR_CLOSE_RESERVE_MS = 700;
/** The most the prior Session's hangups may wait, budget permitting. */
export const PRIOR_HANGUP_BUDGET_MS = 1_000;

/** The drain's share: what is left of the budget after keeping the tail reserve. Never negative. */
export function openDrainLimit(elapsedMs: number): number {
  return Math.max(0, OPEN_BUDGET_MS - OPEN_TAIL_RESERVE_MS - elapsedMs);
}

/** The prior Session's hangup wait: what is left after keeping the close reserve, at most 1,000 ms. */
export function priorHangupBudget(elapsedMs: number): number {
  return Math.max(0, Math.min(PRIOR_HANGUP_BUDGET_MS, OPEN_BUDGET_MS - PRIOR_CLOSE_RESERVE_MS - elapsedMs));
}

type OpenReq = Infer<typeof OpenRequest>;
type OpenRes = Infer<typeof OpenResponse>;

type Phase = "guardMs" | "coreMs" | "ledgerMs" | "tickMs" | "drainMs" | "txMs" | "priorMs" | "deliveryMs";

/** The `open.phases` log line: milliseconds per phase reached, the limits used, and the outcome. Times only. */
interface OpenTimes {
  lap(phase: Phase): void;
  elapsed(): number;
  note(field: "drainLimitMs" | "hangupBudgetMs", ms: number): void;
  drainWon(won: boolean): void;
}

export async function openSession(ctx: RouteContext, req: OpenReq): Promise<OpenRes> {
  const { uid, deps } = ctx;
  const now = () => deps.clock.read().opsClock.now;
  const start = ctx.startedOpsAt ?? now();
  let mark = start;
  const fields: Record<string, number | boolean | string> = {};
  const times: OpenTimes = {
    lap(phase) {
      const t = now();
      fields[phase] = t - mark;
      mark = t;
    },
    elapsed: () => now() - start,
    note: (field, ms) => (fields[field] = ms),
    drainWon: (won) => (fields.drainWon = won),
  };
  let outcome = "error";
  try {
    times.lap("guardMs");
    await ensureCoreDocs(uid, deps, req.clientZone);
    times.lap("coreMs");
    const response = await openInMutation(ctx, req, times);
    outcome = response.state;
    return response;
  } finally {
    // IDs and times only: no request body, no Head text.
    deps.log("open.phases", { ...fields, totalMs: now() - start, outcome });
  }
}

async function openInMutation(ctx: RouteContext, req: OpenReq, times: OpenTimes): Promise<OpenRes> {
  const { uid, deps } = ctx;
  return mutation(ctx, "open", req.requestId, req, async (key) => {
    times.lap("ledgerMs");
    const expiry = startTick(ctx);
    if (expiry !== null) await expiry;
    times.lap("tickMs");

    const drainLimit = openDrainLimit(times.elapsed());
    times.note("drainLimitMs", drainLimit);
    const drain = drainExtractJobs(uid, deps);
    const won = await raceLimit(drain, drainLimit, deps.timers);
    times.drainWon(won);
    if (!won) ctx.schedule(() => drain);
    times.lap("drainMs");

    const sessionId = deps.hasher.id(idParts.session(uid, req.requestId));
    const { response, prior, stamp, session, narrow } = await deps.store.transaction(uid, async (tx) => {
      // The request entry is read with the core documents, in the same round trip: `completeRequest` reads it again
      // at the end, which the transaction answers from what it already read (the tail reserve's count, below).
      // Brief 048 ruling 7: the pending acknowledgments are read in the same round trip, outside the transaction (`outsideTx`).
      // Brief 052 ruling 6: the two meet rows by ID, in the same first round, so every read precedes the first write.
      const [core, , ackCandidates, meetRows] = await Promise.all([readCoreDocs(tx, uid), tx.get(key.path), readAckCandidates(outsideTx(deps.store, uid), uid), readMeetRows(tx, uid, deps.hasher)]);
      const ops = deps.clock.read().opsClock.now;
      if (core.epoch.data.barrier !== null) {
        const blocked: OpenRes = { sessionId, generation: 0, deck: null, state: "blocked", ack: null, proactive: null, audience: null };
        await completeRequest(tx, key, blocked, ops);
        return { response: blocked, prior: null, stamp: null, session: null, narrow: false };
      }

      checkOpenVisit(core.state.data, req.visitId); // Brief 030 P1-8: a named visit opens only on its clone.
      const state: CoreState = { ...core.state.data, currentZone: req.clientZone };
      const pair = ownerClock(state, deps.clock);
      // Open proposals (brief 012 G39) are applied before the Head is compiled, so the Deck carries them.
      const applied = applyProposals(core.rules.data);
      const rules = applied.rules;
      if (applied.changed) tx.update(paths.core(uid, "rules"), rules);
      // Brief 026 (R14.2, R14.8): the Session this open replaces, read under the Owner's uid, passes on a narrowed
      // audience while its waitDeadline holds; the Head is compiled for that audience. Otherwise private, as before.
      // Brief 045 (finding 2): also the Owner's active Session and the latest closing or closed one; the narrowest wins.
      // Brief 048: whether each acknowledgment was already said is read beside the Sessions, in the same round trip.
      const [candidates, due] = await Promise.all([inheritCandidates(tx, uid, { named: req.previousSessionId, active: core.epoch.data.activeSessionId, sessionId }), dueAcks(tx, uid, ackCandidates, deps.hasher)]);
      const inherited = narrowestInherited(candidates, ops);
      const compiled = await readSnapshot(deps.store, uid, (reader) => buildHead(reader, uid, { epoch: core.epoch.data, rules }, pair, 1, inherited?.audience));
      if (!compiled.ok) throw configError(500, "head fixed sections exceed the token cap");
      const head = compiled.head;
      const now = tsFromMs(ops);

      const priorId = core.epoch.data.activeSessionId;
      const prior = priorId !== null && priorId !== sessionId ? await beginCloseInTx(tx, uid, priorId, ops, core.epoch) : null;

      const bundle: CoreBundle = {
        ...core.bundle.data,
        state: "clean",
        bundleRev: core.bundle.data.bundleRev + 1,
        rulesRev: rules.rulesRev,
        head,
        headHash: deps.hasher.sha256(utf8(head.text)),
        selectedRefs: head.selectedRefs,
        compiledAt: now,
        expiresAt: tsFromMs(ops + DECK_TTL_MS),
        updatedAt: now,
      };
      tx.update(paths.core(uid, "bundle"), bundle);

      const stamp = currentStamp(sessionId, 1, { epoch: core.epoch.data, rules, bundle });
      const fresh = newSession(uid, { stamp, now: ops, startedBy: req.initiator });
      // Brief 045 (finding 5): inside the owner's hold, the new Session holds insights, celebrations and asks too.
      const held = holdCarried(state, pair.worldClock.now) ? { ...fresh, transitionCandidateSeq: 0 } : fresh;
      const created = inherited === null ? held : inheritedSession(held, inherited);
      tx.create(paths.session(uid, sessionId), created);
      const epoch: CoreEpoch = { ...core.epoch.data, activeSessionId: sessionId, activeCallId: null, updatedAt: now };
      tx.update(paths.core(uid, "epoch"), epoch);
      tx.update(paths.core(uid, "state"), { ...state, updatedAt: now });

      // Brief 026 (R14.3; question 81): the swap line, only on an open that inherited a company audience with no
      // crisis. Its Permit comes from the Admission_Seam, which writes its decision in this transaction.
      let proactive: Proactive | null = null;
      // Brief 048 rulings 7 and 13: the first fresh call after a forget's blockedAt says its acknowledgment, once, in
      // place of the swap line; it carries no content, so it plays whatever audience the call inherited.
      const ackTurn = ackTurnId(deps.hasher, sessionId, due);
      const ack = due.length === 0 ? null : await takeDueAck(tx, uid, due, { opsNow: ops, audience: created.audience, turn: { sessionId, turnId: ackTurn } }, deps.hasher);
      if (ack !== null) {
        const turnId = ackTurn;
        const admitted = admitRule(
          tx,
          { uid, requestId: req.requestId, requestEntryId: key.keyHash, turnRef: turnRef(turnId, sessionId, 1), core: { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev }, opsNow: ops, stamp: { ...stamp, turnId }, head, notes: [], turns: [], audioIds: [], toolOutput: null, rule: ackRule(ack.line, created.audience) },
          deps,
        );
        if (admitted.kind === "permit" && admitted.notes.length === 1) proactive = { turnId, permit: admitted.permit, whisper: admitted.notes[0]!, cards: [] };
      } else if (inherited !== null && speaksSwapLine(inherited)) {
        const turnId = swapLineTurnId(deps.hasher, sessionId);
        const admitted = admitRule(
          tx,
          { uid, requestId: req.requestId, requestEntryId: key.keyHash, turnRef: turnRef(turnId, sessionId, 1), core: { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev }, opsNow: ops, stamp: { ...stamp, turnId }, head, notes: [], turns: [], audioIds: [], toolOutput: null, rule: swapLineRule },
          deps,
        );
        if (admitted.kind === "permit" && admitted.notes.length === 1) proactive = { turnId, permit: admitted.permit, whisper: admitted.notes[0]!, cards: [] };
      }
      // Brief 052 rulings 5 and 6: the first meeting's line, after the acknowledgment and the swap line had their turn,
      // only on a private open that inherited nothing, with no crisis or hold, no owner name and an offer left; not on a
      // sample visit until the owner rules on contract question M-1 (spec §15 beat 1 opens the sample with the wish). Its
      // row is written beside its Permit's decision, so an offer is consumed only when the line goes out.
      const rowCtx = { opsNow: ops, core: { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev } };
      const offer = meetOffer(meetRows, {
        acked: ack !== null,
        inherited: inherited !== null,
        audience: created.audience,
        crisis: created.modifiers.crisis !== null,
        held: holdCarried(state, pair.worldClock.now),
        ownerName: compiled.ownerName,
        sampleVisit: state.clockMode === "fixture",
      });
      if (proactive === null && offer !== null) {
        const turnId = meetTurnId(deps.hasher, sessionId);
        const admitted = admitRule(
          tx,
          { uid, requestId: req.requestId, requestEntryId: key.keyHash, turnRef: turnRef(turnId, sessionId, 1), core: rowCtx.core, opsNow: ops, stamp: { ...stamp, turnId }, head, notes: [], turns: [], audioIds: [], toolOutput: null, rule: meetRule(meetLineOf(offer)) },
          deps,
        );
        if (admitted.kind === "permit" && admitted.notes.length === 1) {
          proactive = { turnId, permit: admitted.permit, whisper: admitted.notes[0]!, cards: [] };
          recordMeetSaid(tx, uid, offer, { ...rowCtx, sessionId: sessionId as ID, turnId, permitId: admitted.permit.permitId }, deps.hasher);
        }
      }
      // Ruling 6: knowing a name closes the meeting, so a later forget of the name never brings the question back.
      if (compiled.ownerName !== null) closeMeet(tx, uid, meetRows, rowCtx, deps.hasher);
      const opened: OpenRes = { sessionId, generation: 1, deck: issueDeck(stamp, head, ops), state: "connecting", ack: stateAck(stamp, ops), proactive, audience: created.audience };
      await completeRequest(tx, key, opened, ops);
      return { response: opened, prior: prior === null ? null : { id: priorId!, ...prior }, stamp, session: created, narrow: inherited !== null };
    });
    times.lap("txMs");
    // Brief 048 ruling 6: an open that met a barrier gives the forget behind it one pass, so the client's retry finds it cleared.
    if (response.state === "blocked") await openForgetPass(ctx);

    if (prior !== null) {
      if (prior.closed) await afterClosed(ctx, prior.id);
      else {
        const budget = priorHangupBudget(times.elapsed());
        times.note("hangupBudgetMs", budget);
        const ok = await hangupAll(prior.callIds, deps, budget);
        const t = deps.clock.read().opsClock.now;
        await deps.store.transaction(uid, (tx) => finishCloseInTx(tx, uid, prior.id, ok, t, ctx, true));
        // The hangups that did not answer in time keep running; the Job retries any that failed (R11.3).
        if (!ok) ctx.schedule(() => driveHangupJob(uid, hangupJobId(prior.id, deps.hasher), deps));
        await afterClosed(ctx, prior.id);
      }
      times.lap("priorMs");
    }
    // Brief 030 part A: delivery's opening line, gated inside `chooseNow`, only where no swap line was spoken.
    // Brief 045 (finding 4): an open that inherited a narrowed audience says the swap line or nothing.
    // Brief 045, finding 3: no Deck, no line (its Permit binds the Deck's Head and safe turns).
    if (stamp === null || response.state !== "connecting" || response.proactive !== null || narrow || response.deck === null) return response;
    // The budget is the contract; the line is optional: delivery gets what is left of it, as one deadline.
    const proactive = await openingProactive(ctx, stamp, OPEN_BUDGET_MS - times.elapsed(), session ?? undefined, response.deck);
    times.lap("deliveryMs");
    return { ...response, proactive };
  });
}

export const openRoute: RouteSpec<OpenReq> = {
  name: "open",
  parse: ({ body }) => parseWith(OpenRequest, body),
  run: (ctx, req) => openSession(ctx, req),
};
