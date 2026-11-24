/**
 * The Parse_Repair (voice-control R15.3–R15.6, R15.8; design "The Parse_Repair", question 80).
 *
 * One retry of a Slow_Parse that failed by deadline, transport or an invalid answer, run after the `/api/turn` response is sent, with
 * its own 2,000 ms deadline. It commits only while the Session's `parseLease` still holds this repair's token:
 *   ordinary  the Turn's parse commits, the lease clears and the watermark moves; the stored audience is untouched
 *   hit       the same, then the late-hit effects: `policyRev + 1` (the next Deck cancels older speech, KV05) and
 *             one `decision` with `heldRefs:[turn]`; no late reply is spoken
 *   failed    `parseState` stays `failed`, the lease clears, the audience is `unknown` until a parsed `alone`
 * After `ordinary` or `hit`, the hardRule route runs once as a proposal (`onturn/late.ts`; brief 012 G20, G39).
 * A parsed `alone` never moves the watermark past a gap (R15.8).
 *
 * Owner, Nov 19 (company mode off; `company-off.ts`): the failed turn already counts as an ordinary committed parse,
 * so no lease was opened. The repair still runs once, lease-free, for its late hit and the hardRule route: on a Turn
 * that is not dead, of a Session still open; `failed` changes nothing, and nothing stores `unknown`.
 */
import { type CoreEpoch, type ID, type Session, type Turn, changesWhatIsSaid, msFromTs, tsFromMs } from "@franki/core";
import { lateHitDecisionId, recordLateHit } from "../admission/seam";
import { advancedWatermark, effectiveAudience, expireLease } from "../audience";
import { failedParseIsOrdinary } from "../company-off";
import { isDemoVisit } from "../demo/visit";
import { runRepairRoute } from "../onturn/late";
import type { RouteDeps } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import { type Tx, readSnapshot } from "../store/port";
import { decisionsPort } from "./decisions-port";
import { runSlowParse } from "./slow-parse";
// Brief 035 (finding 1): a late company or quiet hit narrows, as it would on the turn.
import { type CoreBundle, type CoreRules, type CoreState } from "@franki/core";
import { lateNarrowing, precompileAudienceHead, withNarrowHead } from "../audience-swap";
import { ownerClock } from "../core-docs";
import { driveHangupJob, ensureHangupJob } from "../worker/hangup";
import { ensureExtractJobs } from "../worker/extract-jobs";
import { drainExtractJobs } from "../worker/drain";

/** The Parse_Repair's Decisions deadline (R15.3). */
export const REPAIR_DEADLINE_MS = 2_000;
/** Transaction attempts before the repair gives up; its lease then runs out, which stores `unknown`. */
const REPAIR_TX_ATTEMPTS = 8;

export type RepairResult = "ordinary" | "hit" | "failed" | "lostLease" | "skipped";

export interface RepairTarget {
  sessionId: ID;
  turnId: ID;
  /** The lease token the failed turn's post wrote. */
  token: ID;
}

/** Whether a failed parse gets a Parse_Repair: a missed deadline, a transport error or an invalid answer (R15.3; review of the live run, item 4). Oversize never does. */
export const repairs = (why: string): boolean => why === "deadline" || why === "transport" || why === "invalid";

export async function runParseRepair(uid: string, deps: RouteDeps, target: RepairTarget): Promise<RepairResult> {
  const { sessionId, turnId, token } = target;
  const turnPath = paths.turn(uid, sessionId, turnId);
  const stored = await deps.store.get<Turn>(uid, turnPath);
  const leaseFree = failedParseIsOrdinary(deps.env);
  if (stored === null || stored.data.role !== "user" || (!leaseFree && stored.data.parseState !== "failed") || stored.data.text === null) return "skipped";
  const slow = await runSlowParse({ decisions: decisionsPort(deps), env: deps.env, log: deps.log, trace: deps.trace }, { turnId, utterance: stored.data.text }, REPAIR_DEADLINE_MS);
  // Brief 035: the narrow Head a late company or quiet hit needs, compiled before the transaction as the turn does.
  const sessionGen = (await deps.store.get<Session>(uid, paths.session(uid, sessionId)))?.data.generation ?? 1;
  const audienceHead = await precompileAudienceHead({ uid, deps }, slow, sessionGen);
  // Kiroween Demo (contract question 97): a repair runs after the response, with no token, so the connectors say
  // whether this is a demo visit. Read before the transaction, so its reads add nothing to it.
  const demo = await readSnapshot(deps.store, uid, (reader) => isDemoVisit({ uid, env: deps.env, hasher: deps.hasher }, reader));
  let hangupJob: ID | null = null;

  // A concurrent write (a receipt, the next turn) loses this compare-and-set: run the transaction again, as the
  // routes do. Each attempt re-reads the Session and re-checks the lease (review of wave A, item 18).
  let result: RepairResult | null = null;
  for (let attempt = 1; result === null; attempt++) {
    try {
      result = await deps.store.transaction(uid, (tx) => repairTx(tx));
    } catch (error) {
      if (!isStoreError(error, "staleRevision") || attempt >= REPAIR_TX_ATTEMPTS) throw error;
    }
  }
  deps.log("turn.repair", { turnId, result, ms: slow.ms });
  // Brief 035 (finding 1): a narrowing with a live call hangs up after the commit, with the Job's backoff.
  const job = hangupJob as ID | null;
  if (job !== null) {
    await driveHangupJob(uid, job, deps, async (id) => {
      await ensureExtractJobs(uid, id, deps);
      await drainExtractJobs(uid, deps);
    });
  }
  // Brief 012 G20 (task B9): with the parse committed, the hardRule route runs once, outside the lease, as a proposal.
  if (result === "ordinary" || result === "hit") await runRepairRoute({ uid, deps }, { sessionId, turnId }, slow, demo);
  return result;

  async function repairTx(tx: Tx): Promise<RepairResult> {
    hangupJob = null;
    const doc = await tx.get<Session>(paths.session(uid, sessionId));
    const turn = await tx.get<Turn>(turnPath);
    if (doc === null || turn === null) return "skipped";
    const ops = deps.clock.read().opsClock.now;
    const now = tsFromMs(ops);
    const s0 = doc.data;
    // Only the lease this repair's turn opened, and only inside its window; a lease past its window is a failed repair.
    if (leaseFree) {
      if (turn.data.state === "dead" || (s0.status !== "active" && s0.status !== "minting")) return "skipped";
    } else if (s0.parseLease === null || s0.parseLease.token !== token || msFromTs(s0.parseLease.until) <= ops) {
      const expired = expireLease(s0, ops);
      if (expired !== s0) tx.update(doc.path, { ...expired, updatedAt: now });
      return "lostLease";
    }
    const s = leaseFree ? s0 : { ...s0, parseLease: null };
    // Company mode off: the turn already counts as an ordinary committed parse, so a failed repair changes nothing.
    if (slow.parse.kind === "failed" && leaseFree) return "failed";
    if (slow.parse.kind === "failed") {
      tx.update(doc.path, { ...s, audience: "unknown", updatedAt: now });
      return "failed";
    }
    tx.update(turnPath, { ...turn.data, parseState: "committed", uncertainSpeaker: slow.probabilities?.uncertainSpeaker ?? 0, updatedAt: now } satisfies Turn);
    // The Turn's own committed parse closes its own gap, `alone` included; R15.8 only says `alone` doesn't close
    // another Turn's gap, and advancedWatermark moves only over contiguous committed Turns (review item 20).
    const committedParseSeq = await advancedWatermark(tx, uid, sessionId, s, turn.data.seq);
    if (slow.parse.kind !== "hit") {
      tx.update(doc.path, { ...s, committedParseSeq, updatedAt: now });
      return "ordinary";
    }

    // The held decision is on the record for any hit; only a route that changes what is said and fires raises
    // policyRev, which cancels speech (review of the live run, item 5). A Turn with no stored verdict is not O.
    const judge = turn.data.judge ?? (turn.data.itemIds.length === 0 ? "typed" : "timeout");
    const epochDoc = await tx.get<CoreEpoch>(paths.core(uid, "epoch"));
    if (epochDoc === null) {
      tx.update(doc.path, { ...s, committedParseSeq, updatedAt: now });
      return "hit";
    }
    // Brief 035 (finding 1): a company or quiet hit narrows here as it would have on the turn (lateNarrowing).
    const [bundleDoc, rulesDoc, stateDoc] = await Promise.all([tx.get<CoreBundle>(paths.core(uid, "bundle")), tx.get<CoreRules>(paths.core(uid, "rules")), tx.get<CoreState>(paths.core(uid, "state"))]);
    const narrowing =
      bundleDoc === null || rulesDoc === null || stateDoc === null
        ? null
        : await withNarrowHead(tx, uid, lateNarrowing({ sessionId, session: s, parse: slow.parse, judge, epoch: epochDoc.data, bundle: bundleDoc.data, rules: rulesDoc.data, opsNow: ops, head: audienceHead, hasher: deps.hasher }), {
            epoch: epochDoc.data,
            rules: rulesDoc.data,
            bundle: bundleDoc.data,
            clock: ownerClock(stateDoc.data, deps.clock),
            generation: s0.generation,
            opsNow: ops,
            hasher: deps.hasher,
            ...(demo ? { playsOwner: true } : {}),
          });
    tx.update(doc.path, { ...s, ...(narrowing?.session ?? {}), committedParseSeq, updatedAt: now });
    if (narrowing?.bundle) tx.update(paths.core(uid, "bundle"), narrowing.bundle);
    if (narrowing?.hangup) hangupJob = await ensureHangupJob(tx, uid, sessionId, s0.rev, ops, deps.hasher);
    const cuts = narrowing === null && changesWhatIsSaid(slow.parse, judge, "A");
    const epoch: CoreEpoch = narrowing !== null ? narrowing.epoch : cuts ? { ...epochDoc.data, policyRev: epochDoc.data.policyRev + 1, updatedAt: now } : epochDoc.data;
    if (narrowing !== null || cuts) tx.update(epochDoc.path, epoch);
    // Nothing is admitted for a late hit: the seam records one held decision for the Turn (item 22).
    recordLateHit(tx, { uid, sessionId, turnId, core: { epoch: epoch.epoch, policyRev: epoch.policyRev }, opsNow: ops, audience: effectiveAudience({ ...s, ...(narrowing?.session ?? {}) }, ops) }, deps);
    return "hit";
  }
}

/** The ledger ID of a late hit's held decision (kept for callers; the seam owns it). */
export const repairDecisionId = (deps: Pick<RouteDeps, "hasher">, sessionId: string, turnId: string): string => lateHitDecisionId(deps.hasher, sessionId, turnId);
