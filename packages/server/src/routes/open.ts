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
import { drainExtractJobs } from "../worker/drain";
import { driveHangupJob, hangupAll, hangupJobId } from "../worker/hangup";
import { startTick } from "../worker/tick";
import { configError } from "./errors";
import { mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";
// Brief 026: a narrowed audience carried into the fresh call, with the swap line (voice-control task 50).
import { type Proactive, type Session, turnRef } from "@franki/core";
import { admitRule } from "../admission/seam";
import { inheritedAudience, inheritedSession, speaksSwapLine, swapLineRule, swapLineTurnId } from "../audience-swap";
import { checkOpenVisit } from "./open-visit";
import { openingProactive } from "./delivery-wire";

/**
 * Server time for one open, from runRoute's first line to the answer. The browser gives the whole request 5 s
 * (R16.6, `OPEN_TIMEOUT_MS`) from just after it reads the ID token; 1.5 s is left for the network, Next.js and a
 * cold process's first token check and Firestore channel, which the live check showed are not small.
 */
export const OPEN_BUDGET_MS = 3_500;
/**
 * Kept back from the drain for the transaction and the prior Session's close. Measured on the emulator with 75 ms
 * added per Firestore round trip (laptop to us-central1): transaction 520–650 ms, and the prior close's own
 * transaction plus its Extract_Jobs 500–550 ms; the rest is margin for a slower machine.
 */
export const OPEN_TAIL_RESERVE_MS = 1_400;
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

type Phase = "guardMs" | "coreMs" | "ledgerMs" | "tickMs" | "drainMs" | "txMs" | "priorMs";

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
    const { response, prior, stamp } = await deps.store.transaction(uid, async (tx) => {
      const core = await readCoreDocs(tx, uid);
      const ops = deps.clock.read().opsClock.now;
      if (core.epoch.data.barrier !== null) {
        const blocked: OpenRes = { sessionId, generation: 0, deck: null, state: "blocked", ack: null, proactive: null };
        await completeRequest(tx, key, blocked, ops);
        return { response: blocked, prior: null, stamp: null };
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
      const previous = req.previousSessionId === null ? null : await tx.get<Session>(paths.session(uid, req.previousSessionId));
      const inherited = inheritedAudience(previous?.data ?? null, ops);
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
      tx.create(paths.session(uid, sessionId), inherited === null ? fresh : inheritedSession(fresh, inherited));
      const epoch: CoreEpoch = { ...core.epoch.data, activeSessionId: sessionId, activeCallId: null, updatedAt: now };
      tx.update(paths.core(uid, "epoch"), epoch);
      tx.update(paths.core(uid, "state"), { ...state, updatedAt: now });

      // Brief 026 (R14.3; question 81): the swap line, only on an open that inherited a company audience with no
      // crisis. Its Permit comes from the Admission_Seam, which writes its decision in this transaction.
      let proactive: Proactive | null = null;
      if (inherited !== null && speaksSwapLine(inherited)) {
        const turnId = swapLineTurnId(deps.hasher, sessionId);
        const admitted = admitRule(
          tx,
          { uid, requestId: req.requestId, requestEntryId: key.keyHash, turnRef: turnRef(turnId, sessionId, 1), core: { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev }, opsNow: ops, stamp: { ...stamp, turnId }, head, notes: [], turns: [], audioIds: [], toolOutput: null, rule: swapLineRule },
          deps,
        );
        if (admitted.kind === "permit" && admitted.notes.length === 1) proactive = { turnId, permit: admitted.permit, whisper: admitted.notes[0]!, cards: [] };
      }
      const opened: OpenRes = { sessionId, generation: 1, deck: issueDeck(stamp, head, ops), state: "connecting", ack: stateAck(stamp, ops), proactive };
      await completeRequest(tx, key, opened, ops);
      return { response: opened, prior: prior === null ? null : { id: priorId!, ...prior }, stamp };
    });
    times.lap("txMs");

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
    if (stamp === null || response.state !== "connecting" || response.proactive !== null) return response;
    return { ...response, proactive: await openingProactive(ctx, stamp, OPEN_BUDGET_MS - times.elapsed()) };
  });
}

export const openRoute: RouteSpec<OpenReq> = {
  name: "open",
  parse: ({ body }) => parseWith(OpenRequest, body),
  run: (ctx, req) => openSession(ctx, req),
};
