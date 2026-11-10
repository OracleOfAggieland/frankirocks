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
  type CoreEpoch,
  DECISIONS_DEADLINE_MS,
  type Evidence,
  type ID,
  type Infer,
  type Ledger,
  type RuleInput,
  type RuleOutcome,
  type SafeTurn,
  type Session,
  type Turn,
  TurnRequest,
  type TurnResponse,
  idParts,
  msFromTs,
  tsFromMs,
  turnRef,
} from "@franki/core";
import { admitRule, fastODecisionId, fastOTurnFields } from "../admission/seam";
import { advancedWatermark, effectiveAudience, expireLease, failedParseEffect, hasParseGap } from "../audience";
import { decisionsPort } from "../intents/decisions-port";
import { repairs, runParseRepair } from "../intents/repair";
import { DECISIONS_NO_CALL_DEADLINE_MS, runSlowParse } from "../intents/slow-parse";
import { ensureCoreDocs, ownerClock, readCoreDocs } from "../core-docs";
import { currentStamp, issueDeck } from "../deck";
import { type RequestKey, completeRequest } from "../ledger/request";
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
  // A Superseding_Post carries a late final transcript for a Turn posted `missing` (R7.8, R11.9; question 89).
  if (req.supersedesRequestId !== null && (req.source !== "asr" || req.transcriptState !== "final" || req.items.length === 0)) throw parseError("only a final ASR turn supersedes");
  if (req.supersedesRequestId !== null && req.supersedesRequestId === req.requestId) throw parseError("a request can't supersede itself");
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
  return safeTurnsOf(tx, uid, rows, beforeSeq, ctx);
}

/**
 * The SafeTurns among rows already read (the Session's turns with `seq ≥ beforeSeq - 4`, in any order): those with
 * `seq < beforeSeq`, in Turn order, the last four. The state route passes the rows of its S2 check (review item 2).
 */
export async function safeTurnsOf(tx: Pick<Tx, "get">, uid: string, rows: readonly { id: string; data: Turn }[], beforeSeq: number, ctx: RouteContext): Promise<SafeTurn[]> {
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

/** True when the Session has no call open: no current call and none registered (the typed path, R18.6). */
async function noCallOpen(ctx: RouteContext, sessionId: string): Promise<boolean> {
  const doc = await ctx.deps.store.get<Session>(ctx.uid, paths.session(ctx.uid, sessionId));
  return doc !== null && doc.data.callId === null && doc.data.registeredCallIds.length === 0;
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
    if (req.supersedesRequestId !== null) return postSupersede(ctx, req, req.supersedesRequestId, key);
    const typedText = req.transcriptState === "final" ? normalizedTranscript(req.transcript)! : "";
    const cls = classifyTurn(req);
    // Every final ASR transcript and typed U line is parsed (R11.1); pasted T text never is (R8.10). With no call,
    // the typed reply's Responses call runs beside it (R8.9).
    const parses = req.transcriptState === "final" && cls.cls === "U";
    const decisions = decisionsPort(deps);
    // With no call open, a typed line's parse runs beside its typed reply, which takes longer than 350 ms anyway,
    // so the parse gets 2,000 ms (review of wave A, item 17).
    const noCall = req.source !== "asr" && (await noCallOpen(ctx, req.sessionId));
    const deadlineMs = noCall ? DECISIONS_NO_CALL_DEADLINE_MS : DECISIONS_DEADLINE_MS;
    const [slow, reply] = await Promise.all([
      parses ? runSlowParse({ decisions, env: deps.env, log: deps.log }, { turnId: req.turnId, utterance: typedText }, deadlineMs) : Promise.resolve(null),
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
          // With no call open the typed reply is kept on a hit too: the rule decides its notes, and a Fixed_Line
          // replaces it (review of wave A, item 17). With a call, typedReplyNote makes no reply. A pasted (T) turn
          // never carries an S1+ note.
          const candidateNotes = reply === null ? [] : [reply];
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
          const leaseToken = deps.hasher.id(["lease", req.sessionId, req.turnId]);
          if (req.source === "asr" && req.transcriptState !== "final") {
            next = failedParseEffect(s, { clientSeq: req.clientSeq, token: leaseToken, why: req.transcriptState === "missing" ? "missing" : "failedTranscript" }, ops);
          } else if (slow !== null && slow.parse.kind === "failed") {
            next = failedParseEffect(s, { clientSeq: req.clientSeq, token: leaseToken, why: slow.parse.why }, ops);
          }
          // A deadline or transport failure that opened its own lease gets one Parse_Repair after the response (R15.3).
          const repair = slow !== null && slow.parse.kind === "failed" && repairs(slow.parse.why) && next.parseLease?.token === leaseToken ? (leaseToken as ID) : null;
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
          return { kind: "committed" as const, response, jobId, repair };
        });
        if (outcome.kind === "unrecorded") throw new Unrecorded(outcome.response);
        // Extraction and the Parse_Repair start after the response is sent (R18.4, R22.12, R15.3).
        if (outcome.repair !== null) {
          const target = { sessionId: req.sessionId as ID, turnId: req.turnId as ID, token: outcome.repair };
          ctx.schedule(() => runParseRepair(uid, deps, target));
        }
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

/**
 * The Superseding_Post (R7.8, R11.9, R15.7; design "The Superseding_Post", question 89): a late final transcript
 * for a Turn first posted `missing`. It keeps the Turn's `clientSeq` and skips the compare-and-set, commits the
 * parse, the text and new Evidence (KC02) on the existing Turn, and admits nothing: no Permit and no decision.
 */
async function postSupersede(ctx: RouteContext, req: TurnReq, supersedes: string, key: RequestKey): Promise<TurnRes> {
  const { uid, deps } = ctx;
  // The superseded request must be complete and for this Turn.
  const first = await deps.store.get<Extract<Ledger, { kind: "request" }>>(uid, paths.ledger(uid, deps.hasher.id(idParts.request(uid, "turn", supersedes))));
  const firstTurnId = (first?.data.payload.response as { stamp?: { turnId?: unknown } } | null | undefined)?.stamp?.turnId;
  if (first === null || first.data.kind !== "request" || first.data.state !== "complete" || firstTurnId !== req.turnId) throw parseError("supersedesRequestId names no completed request for this turn");

  const text = normalizedTranscript(req.transcript)!;
  const cls = classifyTurn(req);
  const slow = await runSlowParse({ decisions: decisionsPort(deps), env: deps.env, log: deps.log }, { turnId: req.turnId, utterance: text });
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
        const stamp0 = { ...currentStamp(req.sessionId, s0.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data }), turnId: req.turnId };
        const head = core.bundle.data.head;
        const base: TurnRes = {
          requestId: req.requestId,
          stamp: stamp0,
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
        const fresh = req.epoch === stamp0.epoch && req.policyRev === stamp0.policyRev && req.bundleRev === stamp0.bundleRev && req.rulesRev === stamp0.rulesRev;
        if (!fresh) return { kind: "unrecorded" as const, response: { ...base, status: "stale" as const, deck: head === null ? null : issueDeck(stamp0, head, ops) } };

        // The Turn must still wait for this transcript: same seq, same items; else stale with no writes.
        const turnDoc = await tx.get<Turn>(paths.turn(uid, req.sessionId, req.turnId));
        const itemIds = [...req.items].sort((a, b) => a.commitSeq - b.commitSeq).map((i) => i.itemId);
        const t0 = turnDoc?.data;
        const sameItems = t0 !== undefined && t0.itemIds.length === itemIds.length && t0.itemIds.every((id, n) => id === itemIds[n]);
        if (t0 === undefined || t0.role !== "user" || t0.state !== "transcriptMissing" || t0.seq !== req.clientSeq || !sameItems) {
          return { kind: "unrecorded" as const, response: { ...base, status: "stale" as const } };
        }

        // A hit runs as a late hit: policyRev + 1, so the next Deck cancels older speech (KV05; R15.5).
        const hit = slow.parse.kind === "hit";
        const epoch: CoreEpoch = hit ? { ...core.epoch.data, policyRev: core.epoch.data.policyRev + 1, updatedAt: tsFromMs(ops) } : core.epoch.data;
        if (hit) tx.update(paths.core(uid, "epoch"), epoch);
        const coreVals = { epoch: epoch.epoch, policyRev: epoch.policyRev };
        const stamp = { ...currentStamp(req.sessionId, s0.generation, { epoch, rules: core.rules.data, bundle: core.bundle.data }), turnId: req.turnId };

        const { evidence } = userTurnRecords({ uid, sessionId: req.sessionId, req, text, cls, clock: pair, core: coreVals, hasher: deps.hasher });
        const ev = evidence!;
        tx.create(paths.evidence(uid, ev.eid), ev.record);
        const jobId = extractJobId(ev.eid, deps.hasher);
        tx.create(paths.job(uid, jobId), extractJobRecord(uid, ev.eid, ev.record, ops, coreVals));

        const parsed = slow.parse.kind !== "failed";
        const now = tsFromMs(ops);
        tx.update(turnDoc!.path, {
          ...t0,
          state: "committed",
          text,
          evidenceId: ev.eid,
          final: true,
          parseState: parsed ? "committed" : "failed",
          uncertainSpeaker: slow.probabilities?.uncertainSpeaker ?? 0,
          rootSlices: ev.record.fieldSlices.slice(0, 1),
          updatedAt: now,
        } satisfies Turn);

        // A lease past its window is a failed repair; one still naming this Turn is released.
        let s = expireLease(s0, ops);
        if (s.parseLease !== null && s.parseLease.clientSeq === req.clientSeq) s = { ...s, parseLease: null };
        // A committed parse closes the gap; a parsed `alone` never does (R15.4, R15.8). A failed parse is `unknown` (R15.6).
        let committedParseSeq = s.committedParseSeq;
        if (!parsed) s = { ...s, audience: "unknown" };
        else if (!(slow.parse.kind === "hit" && slow.parse.chosen === "alone")) committedParseSeq = await advancedWatermark(tx, uid, req.sessionId, s, req.clientSeq);
        tx.update(doc.path, { ...s, committedParseSeq, lastTurnAt: now, expiresAt: tsFromMs(ops + SESSION_IDLE_MS), updatedAt: now });

        const safe = await earlierSafeTurns(tx, uid, req.sessionId, req.clientSeq, ctx);
        const deck = head === null ? null : issueDeck(stamp, head, ops, safe);
        const response: TurnRes = { ...base, stamp, status: hit ? "ready" : "ordinary", deck };
        await completeRequest(tx, key, response, ops);
        return { kind: "committed" as const, response, jobId };
      });
      if (outcome.kind === "unrecorded") throw new Unrecorded(outcome.response);
      ctx.schedule(() => drainExtractJobs(uid, deps));
      return outcome.response;
    } catch (error) {
      if (isStoreError(error, "staleRevision") && attempt < MAX_CAS_ATTEMPTS) continue;
      throw error;
    }
  }
}

export const turnRoute: RouteSpec<TurnReq> = {
  name: "turn",
  parse: ({ body }) => checkTurnRequest(parseWith(TurnRequest, body)),
  run: (ctx, req) => postTurn(ctx, req),
};
