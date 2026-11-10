/**
 * The Parse_Repair (voice-control R15.3–R15.6, R15.8; design "The Parse_Repair", question 80).
 *
 * One retry of a Slow_Parse that failed by deadline or transport, run after the `/api/turn` response is sent, with
 * its own 2,000 ms deadline. It commits only while the Session's `parseLease` still holds this repair's token:
 *   ordinary  the Turn's parse commits, the lease clears and the watermark moves; the stored audience is untouched
 *   hit       the same, then the late-hit effects: `policyRev + 1` (the next Deck cancels older speech, KV05) and
 *             one `decision` with `heldRefs:[turn]`; no late reply is spoken
 *   failed    `parseState` stays `failed`, the lease clears, the audience is `unknown` until a parsed `alone`
 * A parsed `alone` never moves the watermark past a gap (R15.8).
 */
import { type CoreEpoch, type ID, type Ledger, type Session, type Turn, msFromTs, tsFromMs } from "@franki/core";
import { advancedWatermark, expireLease } from "../audience";
import { cFields } from "../records";
import type { RouteDeps } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { decisionsPort } from "./decisions-port";
import { runSlowParse } from "./slow-parse";

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

/** Whether a failed parse gets a Parse_Repair: only a missed deadline or a transport error (R15.3). */
export const repairs = (why: string): boolean => why === "deadline" || why === "transport";

export async function runParseRepair(uid: string, deps: RouteDeps, target: RepairTarget): Promise<RepairResult> {
  const { sessionId, turnId, token } = target;
  const turnPath = paths.turn(uid, sessionId, turnId);
  const stored = await deps.store.get<Turn>(uid, turnPath);
  if (stored === null || stored.data.role !== "user" || stored.data.parseState !== "failed" || stored.data.text === null) return "skipped";
  const slow = await runSlowParse({ decisions: decisionsPort(deps), env: deps.env, log: deps.log }, { turnId, utterance: stored.data.text }, REPAIR_DEADLINE_MS);

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
  return result;

  async function repairTx(tx: Tx): Promise<RepairResult> {
    const doc = await tx.get<Session>(paths.session(uid, sessionId));
    const turn = await tx.get<Turn>(turnPath);
    if (doc === null || turn === null) return "skipped";
    const ops = deps.clock.read().opsClock.now;
    const now = tsFromMs(ops);
    const s0 = doc.data;
    // Only the lease this repair's turn opened, and only inside its window; a lease past its window is a failed repair.
    if (s0.parseLease === null || s0.parseLease.token !== token || msFromTs(s0.parseLease.until) <= ops) {
      const expired = expireLease(s0, ops);
      if (expired !== s0) tx.update(doc.path, { ...expired, updatedAt: now });
      return "lostLease";
    }
    const s = { ...s0, parseLease: null };
    if (slow.parse.kind === "failed") {
      tx.update(doc.path, { ...s, audience: "unknown", updatedAt: now });
      return "failed";
    }
    tx.update(turnPath, { ...turn.data, parseState: "committed", uncertainSpeaker: slow.probabilities?.uncertainSpeaker ?? 0, updatedAt: now } satisfies Turn);
    const alone = slow.parse.kind === "hit" && slow.parse.chosen === "alone";
    const committedParseSeq = alone ? s.committedParseSeq : await advancedWatermark(tx, uid, sessionId, s, turn.data.seq);
    tx.update(doc.path, { ...s, committedParseSeq, updatedAt: now });
    if (slow.parse.kind !== "hit") return "ordinary";

    const epochDoc = await tx.get<CoreEpoch>(paths.core(uid, "epoch"));
    if (epochDoc === null) return "hit";
    const epoch: CoreEpoch = { ...epochDoc.data, policyRev: epochDoc.data.policyRev + 1, updatedAt: now };
    tx.update(epochDoc.path, epoch);
    // Nothing is admitted for a late hit: one held decision, cited by the Turn (design "The Parse_Repair").
    const entry: Extract<Ledger, { kind: "decision" }> = {
      ...cFields(uid, now, epoch.epoch, epoch.policyRev),
      kind: "decision",
      state: "blocked",
      at: now,
      retainUntil: null,
      payload: {
        purpose: "answer",
        acceptedRefs: [],
        heldRefs: [{ type: "turn", id: turnId, parentId: sessionId, rev: 1 }],
        reasonCodes: ["time"],
        audience: s.audience,
      },
    };
    tx.create(paths.ledger(uid, repairDecisionId(deps, sessionId, turnId)), entry);
    return "hit";
  }
}

/** The ledger ID of a late hit's held decision. */
export const repairDecisionId = (deps: Pick<RouteDeps, "hasher">, sessionId: string, turnId: string): string => deps.hasher.id(["repair", sessionId, turnId]);
