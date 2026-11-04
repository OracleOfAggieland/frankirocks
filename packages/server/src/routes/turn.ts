/**
 * POST /api/turn (R18.2–R18.4, R18.7, R18.8, R19, R20, R22.1; KV12; design "One voice turn", "One typed turn").
 *
 * Serialization: one transaction reads the Session, compare-and-sets `nextClientSeq == clientSeq`, and writes the
 * user Turn (`seq = clientSeq`), its Evidence (final transcripts only), its Extract_Job (U only), the Session
 * update and the request ledger entry together. A higher clientSeq answers `hold` with no writes and leaves the
 * requestId free for the retry. A lower clientSeq that is not a recorded replay is an error. A lost
 * compare-and-set commits nothing and is handled again against the new `nextClientSeq` (R19.11).
 */
import {
  type Evidence,
  type Infer,
  type SafeTurn,
  type Session,
  type Turn,
  TurnRequest,
  type TurnResponse,
  tsFromMs,
  turnRef,
} from "@franki/core";
import { admit } from "../admission/seam";
import { ensureCoreDocs, ownerClock, readCoreDocs } from "../core-docs";
import { currentStamp, issueDeck } from "../deck";
import { completeRequest } from "../ledger/request";
import { SESSION_IDLE_MS } from "../sessions";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { classifyTurn, normalizedTranscript, safeTurn, userTurnRecords } from "../turns";
import { drainExtractJobs } from "../worker/drain";
import { extractJobId, extractJobRecord } from "../worker/extract-jobs";
import { barrierError, parseError, scopeError, staleError } from "./errors";
import { Unrecorded, mutation } from "./mutation";
import { typedReplyNote } from "./typed-reply";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

type TurnReq = Infer<typeof TurnRequest>;
type TurnRes = Infer<typeof TurnResponse>;

/** Retry delay for a turn that arrived ahead of its predecessor. */
export const HOLD_RETRY_MS = 250;
/** Compare-and-set attempts before the route answers STALE and the browser retries. */
const MAX_CAS_ATTEMPTS = 8;

/** Request checks beyond the closed schema (R18.1, R18.8, R20.8). */
export function checkTurnRequest(req: TurnReq): TurnReq {
  if (req.uiControl !== null || req.source === "chip" || req.source === "trustedTap") throw parseError("control turns are not built");
  if (req.source === "asr") {
    if (req.items.length === 0) throw parseError("asr needs items");
  } else if (req.items.length !== 0) throw parseError("typed turns carry no items");
  if (req.transcriptState === "final") {
    if (normalizedTranscript(req.transcript) === null) throw parseError("transcript must be 1 to 8192 code units");
  } else if (req.source !== "asr" || req.transcript !== "") throw parseError("missing or failed transcripts are ASR-only and empty");
  return req;
}

/** Up to 4 SafeTurns from the Session's earlier Turns that pass the sensitivity rule (design "Reply input"). */
export async function earlierSafeTurns(tx: Pick<Tx, "get" | "query">, uid: string, sessionId: string, beforeSeq: number, ctx: RouteContext): Promise<SafeTurn[]> {
  if (beforeSeq <= 1) return [];
  const rows = await tx.query<Turn>({
    collection: paths.turns(uid, sessionId),
    where: [{ field: "seq", op: ">=", value: Math.max(0, beforeSeq - 4) }],
    orderBy: { field: "seq", dir: "asc" },
    limit: 100,
  });
  const out: SafeTurn[] = [];
  for (const row of rows) {
    if (row.data.seq >= beforeSeq || row.data.evidenceId === null) continue;
    const ev = await tx.get<Evidence>(paths.evidence(uid, row.data.evidenceId));
    if (ev === null) continue;
    const s = safeTurn(row.id, row.data, ev.data, row.data.evidenceId, ctx.deps.hasher);
    if (s !== null) out.push(s);
  }
  return out.slice(-4);
}

export async function postTurn(ctx: RouteContext, req: TurnReq): Promise<TurnRes> {
  const { uid, deps } = ctx;
  await ensureCoreDocs(uid, deps);
  return mutation(ctx, "turn", req.requestId, req, async (key) => {
    // Typed reply with no call open: one Responses call before the commit, so the note is in the admitted payload.
    const typedText = req.transcriptState === "final" ? normalizedTranscript(req.transcript)! : "";
    const reply = await typedReplyNote(ctx, req, typedText, (reader) => earlierSafeTurns(reader, uid, req.sessionId, req.clientSeq, ctx));
    for (let attempt = 1; ; attempt++) {
      try {
        const outcome = await deps.store.transaction(uid, async (tx) => {
          const doc = await tx.get<Session>(paths.session(uid, req.sessionId));
          if (doc === null) throw scopeError();
          const s = doc.data;
          if (s.generation !== req.generation || (s.status !== "minting" && s.status !== "active")) throw staleError("session");
          const core = await readCoreDocs(tx, uid);
          if (core.epoch.data.barrier !== null) throw barrierError();
          const pair = ownerClock(core.state.data, deps.clock);
          const ops = pair.opsClock.now;
          const stamp = { ...currentStamp(req.sessionId, s.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data }), turnId: req.turnId };
          const head = core.bundle.data.head;
          const base: TurnRes = {
            requestId: req.requestId,
            stamp,
            status: "ordinary",
            deck: null,
            permit: null,
            notes: [],
            cards: [],
            pendingId: null,
            question: null,
            retryAfterMs: 0,
            receiptId: null,
            error: null,
          };

          // Stamp revisions must be current; a stale Stamp commits nothing.
          const fresh = req.epoch === stamp.epoch && req.policyRev === stamp.policyRev && req.bundleRev === stamp.bundleRev && req.rulesRev === stamp.rulesRev;
          if (!fresh) {
            return { kind: "unrecorded" as const, response: { ...base, status: "stale" as const, deck: head === null ? null : issueDeck(stamp, head, ops) } };
          }
          if (req.clientSeq > s.nextClientSeq) {
            return { kind: "unrecorded" as const, response: { ...base, status: "hold" as const, retryAfterMs: HOLD_RETRY_MS } };
          }
          // Lower and not a recorded replay (begin already replays those): an error (R19.10).
          if (req.clientSeq < s.nextClientSeq) throw staleError("clientSeq");

          const text = typedText;
          const cls = classifyTurn(req);
          // A pasted (T) turn's postCommitControl Permit carries no S1+ note, so such a note is dropped.
          const notes = reply === null || (cls.cls === "T" && reply.sens !== "S0") ? [] : [reply];
          const coreVals = { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev };
          const { turn, evidence } = userTurnRecords({ uid, sessionId: req.sessionId, req, text, cls, clock: pair, core: coreVals, hasher: deps.hasher });

          const safe = await earlierSafeTurns(tx, uid, req.sessionId, req.clientSeq, ctx);
          tx.create(paths.turn(uid, req.sessionId, req.turnId), turn);
          let jobId: string | null = null;
          if (evidence !== null) {
            tx.create(paths.evidence(uid, evidence.eid), evidence.record);
            // Extract_Job only for U Evidence (R22.1); pasted T waits for ClaimsV1 (R18.7).
            if (cls.cls === "U") {
              jobId = extractJobId(evidence.eid, deps.hasher);
              tx.create(paths.job(uid, jobId), extractJobRecord(uid, evidence.eid, evidence.record, ops, coreVals));
            }
          }
          const now = tsFromMs(ops);
          tx.update(doc.path, {
            ...s,
            nextClientSeq: req.clientSeq + 1,
            lastClientSeq: req.clientSeq,
            committedParseSeq: req.clientSeq,
            lastTurnAt: now,
            lastUserTurnOpsAt: now,
            expiresAt: tsFromMs(ops + SESSION_IDLE_MS),
            committedItemIds: [...s.committedItemIds, ...turn.itemIds].slice(-64),
            updatedAt: now,
          });

          const deck = head === null ? null : issueDeck(stamp, head, ops, safe);
          // Every reply's Permit comes from the Admission_Seam, which writes its decision ledger entry in this
          // transaction (R17.1, R17.10). In production devAdmit throws CONFIG and nothing commits (R17.5).
          const admitted = admit(
            tx,
            {
              uid,
              requestId: req.requestId,
              turnRef: turnRef(req.turnId, req.sessionId, 1),
              core: coreVals,
              stamp,
              head: deck?.head ?? null,
              notes,
              turns: deck?.turns ?? [],
              audioIds: turn.itemIds,
              toolOutput: null,
              turn: req.source === "asr" ? { kind: "voice", transcriptState: req.transcriptState } : { kind: "typed", cls: cls.cls },
              opsNow: ops,
            },
            deps,
          );
          const response: TurnRes =
            admitted.kind === "permit" ? { ...base, deck, notes, permit: admitted.permit } : { ...base, deck, status: "hold", permit: null };
          await completeRequest(tx, key, response, ops);
          return { kind: "committed" as const, response, jobId };
        });
        if (outcome.kind === "unrecorded") throw new Unrecorded(outcome.response);
        // Extraction starts after the response is sent (R18.4, R22.12).
        if (outcome.jobId !== null) ctx.schedule(() => drainExtractJobs(uid, deps));
        return outcome.response;
      } catch (error) {
        // A lost compare-and-set: handle the request again against the new nextClientSeq (R19.11).
        if (isStoreError(error, "staleRevision") && attempt < MAX_CAS_ATTEMPTS) continue;
        throw error;
      }
    }
  });
}

export const turnRoute: RouteSpec<TurnReq> = {
  name: "turn",
  parse: ({ body }) => checkTurnRequest(parseWith(TurnRequest, body)),
  run: (ctx, req) => postTurn(ctx, req),
};
