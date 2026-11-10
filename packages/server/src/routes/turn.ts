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
  type RuleInput,
  type RuleOutcome,
  type SafeTurn,
  type Session,
  type Turn,
  TurnRequest,
  type TurnResponse,
  msFromTs,
  tsFromMs,
  turnRef,
} from "@franki/core";
import { admitRule, fastODecisionId, fastOTurnFields } from "../admission/seam";
import { effectiveAudience, expireLease, failedParseEffect, hasParseGap } from "../audience";
import { decisionsPort } from "../intents/decisions-port";
import { runSlowParse } from "../intents/slow-parse";
import { ensureCoreDocs, ownerClock, readCoreDocs } from "../core-docs";
import { currentStamp, issueDeck } from "../deck";
import { completeRequest } from "../ledger/request";
import { SESSION_IDLE_MS } from "../sessions";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { classifyTurn, normalizedTranscript, safeTurn, turnOrder, userTurnRecords } from "../turns";
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
  for (const row of [...rows].sort((a, b) => turnOrder(a.data, b.data))) {
    if (row.data.seq >= beforeSeq || row.data.evidenceId === null) continue;
    const ev = await tx.get<Evidence>(paths.evidence(uid, row.data.evidenceId));
    if (ev === null) continue;
    const s = safeTurn(row.id, row.data, ev.data, row.data.evidenceId, ctx.deps.hasher);
    if (s !== null) out.push(s);
  }
  return out.slice(-4);
}

/** The TurnResponse status for a rule outcome (design "Status mapping"; question 60, 92). */
export function statusOf(o: RuleOutcome): TurnRes["status"] {
  if (o.kind === "hold") return o.blocked ? "blocked" : "hold";
  if (o.swap === "afterReply") return "blocked";
  if (o.permit === "recoveryOnly") return o.cut ? "clarify" : "hold";
  if (o.permit === "slowOrdinary") return "ordinary";
  return o.cut ? "ready" : "ordinary";
}

/** At least one ASR word per 2 s of audio (contracts §6 Admission, `slowOrdinary`). */
export function wordsPer2s(transcript: string, items: TurnReq["items"]): boolean {
  const ms = items.reduce((n, i) => n + i.audioDurationMs, 0);
  const words = transcript.trim().split(/\s+/).filter((w) => w !== "").length;
  return words * 2_000 >= ms;
}

export async function postTurn(ctx: RouteContext, req: TurnReq): Promise<TurnRes> {
  const { uid, deps } = ctx;
  await ensureCoreDocs(uid, deps);
  return mutation(ctx, "turn", req.requestId, req, async (key) => {
    const typedText = req.transcriptState === "final" ? normalizedTranscript(req.transcript)! : "";
    const cls = classifyTurn(req);
    // Every final ASR transcript and typed U line is parsed (R11.1); pasted T text never is (R8.10). With no call,
    // the typed reply's Responses call runs beside it (R8.9).
    const parses = req.transcriptState === "final" && cls.cls === "U";
    const decisions = decisionsPort(deps);
    const [slow, reply] = await Promise.all([
      parses ? runSlowParse({ decisions, env: deps.env, log: deps.log }, { turnId: req.turnId, utterance: typedText }) : Promise.resolve(null),
      typedReplyNote(ctx, req, typedText, (reader) => earlierSafeTurns(reader, uid, req.sessionId, req.clientSeq, ctx)),
    ]);
    for (let attempt = 1; ; attempt++) {
      try {
        const outcome = await deps.store.transaction(uid, async (tx) => {
          const doc = await tx.get<Session>(paths.session(uid, req.sessionId));
          if (doc === null) throw scopeError();
          const s0 = doc.data;
          if (s0.generation !== req.generation || (s0.status !== "minting" && s0.status !== "active")) throw staleError("session");
          const core = await readCoreDocs(tx, uid);
          if (core.epoch.data.barrier !== null) throw barrierError();
          const pair = ownerClock(core.state.data, deps.clock);
          const ops = pair.opsClock.now;
          const stamp = { ...currentStamp(req.sessionId, s0.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data }), turnId: req.turnId };
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
          if (req.clientSeq > s0.nextClientSeq) {
            return { kind: "unrecorded" as const, response: { ...base, status: "hold" as const, retryAfterMs: HOLD_RETRY_MS } };
          }
          // Lower and not a recorded replay (begin already replays those): an error (R19.10).
          if (req.clientSeq < s0.nextClientSeq) throw staleError("clientSeq");

          // An earlier failed parse whose repair window ran out is a failed repair (R15.6).
          const s = expireLease(s0, ops);
          const text = typedText;
          // A Control_Hit discards the typed reply (R8.9); a pasted (T) turn never carries an S1+ note.
          const hit = slow !== null && slow.parse.kind === "hit";
          const candidateNotes = reply === null || hit ? [] : [reply];
          const coreVals = { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev };
          const { turn: turn0, evidence } = userTurnRecords({ uid, sessionId: req.sessionId, req, text, cls, clock: pair, core: coreVals, hasher: deps.hasher });

          // The parse and the verdict go on the Turn (R13.2; question 57); its Slice says its Sensitivity (question 61).
          const parsed = slow !== null && slow.parse.kind !== "failed";
          const fastO = await tx.get(paths.ledger(uid, fastODecisionId(deps.hasher, req.sessionId, req.turnId)));
          const turn: Turn = {
            ...turn0,
            rootSlices: evidence === null ? [] : evidence.record.fieldSlices.slice(0, 1),
            parseState: parsed || cls.cls === "T" ? "committed" : "failed",
            judge: req.judge === "O" || req.judge === "H" || req.judge === "U" ? req.judge : null,
            uncertainSpeaker: slow?.probabilities?.uncertainSpeaker ?? 0,
            ...(fastO === null ? {} : fastOTurnFields(msFromTs((fastO.data as { at: string }).at))),
          };

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

          // The parse watermark is contiguous: it moves past this Turn only if every earlier one committed (question 73).
          const committed = turn.parseState === "committed";
          const committedParseSeq = committed && s.committedParseSeq === req.clientSeq - 1 ? req.clientSeq : s.committedParseSeq;
          let next: Session = s;
          if (req.source === "asr" && req.transcriptState !== "final") {
            next = failedParseEffect(s, { clientSeq: req.clientSeq, token: deps.hasher.id(["lease", req.sessionId, req.turnId]), why: req.transcriptState === "missing" ? "missing" : "failedTranscript" }, ops);
          } else if (slow !== null && slow.parse.kind === "failed") {
            next = failedParseEffect(s, { clientSeq: req.clientSeq, token: deps.hasher.id(["lease", req.sessionId, req.turnId]), why: slow.parse.why }, ops);
          }
          const now = tsFromMs(ops);
          tx.update(doc.path, {
            ...next,
            nextClientSeq: req.clientSeq + 1,
            lastClientSeq: req.clientSeq,
            committedParseSeq,
            lastTurnAt: now,
            lastUserTurnOpsAt: now,
            expiresAt: tsFromMs(ops + SESSION_IDLE_MS),
            committedItemIds: [...s.committedItemIds, ...turn.itemIds].slice(-64),
            updatedAt: now,
          });

          const deck = head === null ? null : issueDeck(stamp, head, ops, safe);
          const transcriptState = req.transcriptState;
          const rule: RuleInput = {
            source: req.source === "asr" ? "asr" : cls.cls === "T" ? "pasted" : "typed",
            transcript: transcriptState,
            judge: req.judge,
            parse: slow === null ? { kind: "none" } : slow.parse,
            regexMatch: (slow?.regex.length ?? 0) > 0,
            // The gap and the audience are those before this Turn; its own failure shows from the next one.
            audience: effectiveAudience(s, ops),
            narrowedHere: false,
            callLive: s.registeredCallIds.length > 0,
            parseGap: hasParseGap(s),
            noteSens: candidateNotes.length === 0 ? "none" : candidateNotes.some((n) => n.sens !== "S0") ? "S1+" : "S0",
            wordsPer2s: wordsPer2s(text, req.items),
            allFinal: req.items.every((i) => i.final),
            toolParseCommitted: false,
            wave: "A",
          };
          // Every reply's Permit comes from the Admission_Seam, which writes its decision ledger entry in this
          // transaction and runs in production too (R8.1, R8.2).
          const admitted = admitRule(
            tx,
            {
              uid,
              requestId: req.requestId,
              requestEntryId: key.keyHash,
              turnRef: turnRef(req.turnId, req.sessionId, 1),
              core: coreVals,
              opsNow: ops,
              stamp,
              head: deck?.head ?? null,
              notes: candidateNotes,
              turns: deck?.turns ?? [],
              audioIds: turn.itemIds,
              toolOutput: null,
              rule,
            },
            deps,
          );
          const status = statusOf(admitted.outcome);
          const response: TurnRes = admitted.kind === "permit" ? { ...base, status, deck, notes: admitted.notes, permit: admitted.permit } : { ...base, status, deck, permit: null };
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
