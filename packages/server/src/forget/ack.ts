/**
 * The forget's acknowledgment (brief 048 rulings 7, 8 and 13). Nothing says gone before the receipt's `blockedAt`
 * is set, and the acknowledgment is said once.
 *
 *   - An acknowledgment is due for an op when its receipt has `blockedAt` set (resume sets it) and no delivery row
 *     exists for it. The delivery row is one `decision` ledger row keyed by the op (`forgetAckId`), written by the
 *     reader that says it, in the same transaction as the Permit that says it. A second reader finds the row and says
 *     nothing.
 *   - Readers: the fresh call's open, the typed answer, and the state route for a Session with no call. Each reads the
 *     latest receipts with Q33 (kind, at), then the delivery rows by ID, then each due job's `ack`.
 *   - The words are Fixed_Lines from `voice/lines.ts`, and go out under a Permit from the Admission_Seam (`ackRule`).
 *
 * The rows carry IDs and states only, never words.
 */
import { type AckText, type Au, type Hasher, type ID, type Job, type Ledger, type RuleInput, forgetAckText, tsFromMs } from "@franki/core";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { forgetJobId, forgetReceiptId } from "./fence";

type ForgetAck = NonNullable<Extract<Job["payload"], { kind: "forget" }>["ack"]>;
type Decision = Extract<Ledger, { kind: "decision" }>;
type Receipt = Extract<Ledger, { kind: "forgetReceipt" }>;

/**
 * How many of the latest receipts a reader looks at. An older forget whose acknowledgment was never said is never
 * said (fails closed: silence, never a false "gone").
 */
export const ACK_RECEIPTS_MAX = 8;

export const forgetAckId = (opId: ID, hasher: Hasher): ID => hasher.id(["ledger", "forgetAck", opId]) as ID;

export interface AckCandidate {
  opId: ID;
  receipt: Receipt;
}

/** The latest receipts whose `blockedAt` is set: one query (Q33), run beside the reader's first reads. */
export async function readAckCandidates(tx: Pick<Tx, "query">, uid: string): Promise<AckCandidate[]> {
  const rows = await tx.query<Ledger>({
    collection: paths.collection(uid, "ledger"),
    where: [{ field: "kind", op: "==", value: "forgetReceipt" }],
    orderBy: { field: "at", dir: "desc" },
    limit: ACK_RECEIPTS_MAX,
  });
  const out: AckCandidate[] = [];
  for (const r of rows) if (r.data.kind === "forgetReceipt" && r.data.payload.blockedAt !== null) out.push({ opId: r.data.payload.opId, receipt: r.data });
  return out;
}

/** The candidates with no delivery row yet: one batch of reads by ID. */
export async function dueAcks(tx: Pick<Tx, "get">, uid: string, candidates: readonly AckCandidate[], hasher: Hasher): Promise<AckCandidate[]> {
  const rows = await Promise.all(candidates.map((c) => tx.get(paths.ledger(uid, forgetAckId(c.opId, hasher)))));
  return candidates.filter((_, i) => rows[i] === null);
}

/** One acknowledgment for every due op: the widest kind wins, and the allergy line if any asks for it (fails closed). */
export function mergeAcks(acks: readonly ForgetAck[]): AckText | null {
  if (acks.length === 0) return null;
  const rank = { gone: 0, offerRetell: 1, goneExceptRule: 2, ask: 3 } as const;
  const top = acks.reduce((a, b) => (rank[b.kind] > rank[a.kind] ? b : a));
  const allergies = acks.some((a) => a.kind !== "ask" && a.askAllergies);
  return forgetAckText(top.kind, allergies);
}

/**
 * Takes every due acknowledgment in the caller's transaction: reads each job's `ack`, writes the op's delivery row,
 * and returns the words, or null when none is due. A job with no `ack` yet is skipped and left due (fails closed: no
 * words without the data that chose them). `sessionId`, when given, takes only that Session's forgets.
 */
export async function takeDueAck(
  tx: Tx,
  uid: string,
  due: readonly AckCandidate[],
  x: { opsNow: number; audience: Au; sessionId?: ID | null },
  hasher: Hasher,
): Promise<{ line: AckText; opIds: ID[] } | null> {
  const jobs = await Promise.all(due.map((c) => tx.get<Job>(paths.job(uid, forgetJobId(c.opId, hasher)))));
  const acks: ForgetAck[] = [];
  const opIds: ID[] = [];
  const now = tsFromMs(x.opsNow);
  due.forEach((c, i) => {
    const p = jobs[i]?.data.payload;
    if (p === undefined || p.kind !== "forget" || p.ack === null) return;
    // The job names the request's Session first among its sources (`forgetJob`).
    if ((x.sessionId ?? null) !== null && jobs[i]!.data.sourceIds[0] !== x.sessionId) return;
    acks.push(p.ack);
    opIds.push(c.opId);
    const row: Decision = {
      ...cFields(uid, now, c.receipt.epoch, c.receipt.policyRev),
      kind: "decision",
      state: "complete",
      at: now,
      retainUntil: null,
      payload: {
        purpose: "answer",
        acceptedRefs: [
          { type: "ledger", id: forgetReceiptId(c.opId, hasher), rev: 1 },
          { type: "job", id: forgetJobId(c.opId, hasher), rev: 1 },
        ],
        heldRefs: [],
        reasonCodes: ["ok"],
        audience: x.audience,
      },
    };
    tx.create(paths.ledger(uid, forgetAckId(c.opId, hasher)), row);
  });
  const line = mergeAcks(acks);
  return line === null ? null : { line, opIds };
}

/** The Server_Rule input of the acknowledgment: row 11's typed shape, with no call, carrying the words. */
export const ackRule = (line: AckText, audience: Au): RuleInput => ({
  source: "typed",
  transcript: "final",
  judge: "typed",
  parse: { kind: "hit", chosen: "forget", candidates: ["forget"], uncertain: false, candidateP: { forget: 1 } },
  regexMatch: false,
  audience,
  narrowedHere: false,
  callLive: false,
  parseGap: false,
  noteSens: "none",
  wordsPer2s: true,
  allFinal: true,
  toolParseCommitted: true,
  wave: "B",
  forgetAck: line,
});

/** The synthetic turn the acknowledgment is said as: one per Session and set of ops. */
export const ackTurnId = (hasher: Hasher, sessionId: string, opIds: readonly string[]): ID => hasher.id(["forgetAck", sessionId, ...opIds]) as ID;
