/**
 * POST /api/receipt (R21.1–R21.8; contracts §6 Routes; contract questions 18, 19).
 *
 * Every receipt is checked against the server's current Stamp: the Session must be this Owner's (else SCOPE)
 * and its `generation`, `epoch`, `policyRev`, `bundleRev` and `rulesRev` must all be current, else the answer
 * is `accepted:false` with no Turn, Evidence or job written.
 *
 * A `transcript` receipt writes, in one transaction, the assistant Turn (ID `H("aturn", sessionId, responseId)`,
 * `role:"assistant"`, `seq = Session.nextClientSeq - 1`, `state:"transcribed"`) and its Evidence (`kind:"turn"`,
 * `authorship:"unknown"`, `authorId:null`, one whole-text Slice of class M; contract question 18). The Turn's role
 * marks Franki as the author. No Extract_Job is written, so assistant words never become Memories (R21.4). A
 * repeated transcript for the same `responseId` answers `accepted:true` and writes nothing new.
 * Playback receipts are acknowledged and push the Session's idle expiry forward.
 */
import {
  type Evidence,
  type Infer,
  ReceiptRequest,
  type ReceiptResponse,
  type Session,
  type Turn,
  buildSlice,
  idParts,
  normalizeLF,
  sensFloor,
  tsFromMs,
} from "@franki/core";
import { recordFastO } from "../admission/seam";
import { effectiveAudience } from "../audience";
import { ensureCoreDocs, ownerClock, readCoreDocs } from "../core-docs";
import { currentStamp, sameStamp } from "../deck";
import { completeRequest } from "../ledger/request";
import { cFields } from "../records";
import { SESSION_IDLE_MS } from "../sessions";
import { evidenceId } from "../store/evidence";
import { paths } from "../store/paths";
import { barrierError, parseError, scopeError } from "./errors";
import { mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";
import { retryStale } from "./state";
import { askAfterSpoken } from "../onturn/ask";
import { goneCheck, receiptMoments } from "./receipt-moments";

type ReceiptReq = Infer<typeof ReceiptRequest>;
type ReceiptRes = Infer<typeof ReceiptResponse>;

export function checkReceiptRequest(req: ReceiptReq): ReceiptReq {
  if (req.kind === "transcript") {
    if (req.text === null || req.text.trim() === "") throw parseError("transcript needs text");
  } else if (req.text !== null) throw parseError("only transcript receipts carry text");
  return req;
}

export async function postReceipt(ctx: RouteContext, req: ReceiptReq): Promise<ReceiptRes> {
  const { uid, deps } = ctx;
  await ensureCoreDocs(uid, deps);
  return mutation(ctx, "receipt", req.requestId, req, (key) =>
    retryStale(() =>
      deps.store.transaction(uid, async (tx) => {
        const doc = await tx.get<Session>(paths.session(uid, req.stamp.sessionId));
        if (doc === null) throw scopeError();
        const s = doc.data;
        const core = await readCoreDocs(tx, uid);
        if (core.epoch.data.barrier !== null) throw barrierError(); // Brief 038 finding 2: nothing lands during a reset or forget.
        const pair = ownerClock(core.state.data, deps.clock);
        const ops = pair.opsClock.now;
        const now = tsFromMs(ops);
        const current = currentStamp(req.stamp.sessionId, s.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data });
        if (!sameStamp(req.stamp, current)) {
          const refused: ReceiptRes = { accepted: false, controlCheck: "none" };
          await completeRequest(tx, key, refused, ops);
          return refused;
        }
        const accepted: ReceiptRes = { accepted: true, controlCheck: goneCheck(req) };
        const live = s.status === "minting" || s.status === "active";

        if (req.kind === "transcript") {
          const turnId = deps.hasher.id(idParts.assistantTurn(req.stamp.sessionId, req.responseId));
          const turnPath = paths.turn(uid, req.stamp.sessionId, turnId);
          if ((await tx.get<Turn>(turnPath)) !== null) {
            await completeRequest(tx, key, accepted, ops);
            return accepted;
          }
          const text = normalizeLF(req.text!).slice(0, 4096);
          const world = tsFromMs(pair.worldClock.now);
          const coreVals = { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev };
          const logicalId = deps.hasher.id(idParts.evidenceLogical(turnId));
          const eid = evidenceId(logicalId, 1, deps.hasher);
          const slice = buildSlice({ eid, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: "M", sens: sensFloor(text) }, deps.hasher);
          const evidence: Evidence = {
            ...cFields(uid, now, coreVals.epoch, coreVals.policyRev),
            logicalId,
            revisionOf: null,
            sanitizedFrom: null,
            source: "voice",
            providerKey: null,
            providerRevision: null,
            connectorId: null,
            generation: s.generation,
            threadKey: null,
            inReplyToProviderKey: null,
            closureProofs: [],
            kind: "turn",
            status: "retained",
            isCurrentProvider: true,
            occurredAt: world,
            assertedAt: world,
            receivedAt: now,
            zone: pair.worldClock.zone,
            fieldSlices: [slice],
            body: null,
            bodyOwn: null,
            bodyQuoted: null,
            subject: null,
            title: null,
            description: null,
            text: { kind: "inline", text },
            sender: null,
            recipient: [],
            observation: { kind: "none" },
            authorId: null,
            senderAddressKey: null,
            recipientAddressKeys: [],
            authorship: "unknown",
            delivery: "unknown",
            senderAuth: "unknown",
            identityBinding: "none",
            route: "unknown",
            sessionId: req.stamp.sessionId,
            turnId,
            itemIds: [],
            transcriptState: "complete",
            transcriptDeadline: null,
            controlTurn: false,
            extractPacketMode: "singleTurn",
            parserVersion: "turn-v1",
            copyRootKey: null,
            replacedProviderKey: null,
            sanitizeMap: [],
            purgedAt: null,
          };
          const turn: Turn = {
            ...cFields(uid, now, coreVals.epoch, coreVals.policyRev),
            sessionId: req.stamp.sessionId,
            // Assistant Turns never advance nextClientSeq; they take the last user clientSeq (R19.5).
            seq: Math.max(0, s.nextClientSeq - 1),
            role: "assistant",
            itemIds: [],
            evidenceId: eid,
            state: "transcribed",
            text,
            committedAt: now,
            audibleEndAt: null,
            transcriptDeadline: now,
            judge: null,
            judgeResponseId: null,
            spokenResponseId: req.responseId,
            parseState: "committed",
            final: true,
            audioDurationMs: 0,
            lastFragmentOpsAt: null,
            sourceClass: "M",
            uncertainSpeaker: 0,
            noteIds: [],
            noteTokens: [],
            pendingId: null,
            momentIds: [],
            admittedAt: null,
            playbackAt: null,
            saidMatch: "none",
            retainUntil: null,
          };
          tx.create(paths.evidence(uid, eid), evidence);
          tx.create(turnPath, turn);
          // The open allergy question (brief 012 design 6.4): asked only once Franki's words held it.
          const ask = askAfterSpoken(core.rules.data, req.stamp.sessionId, turn.seq, text);
          if (ask !== null) tx.update(paths.core(uid, "rules"), { ...core.rules.data, ask });
        }
        if (live) tx.update(doc.path, { ...s, lastTurnAt: now, expiresAt: tsFromMs(ops + SESSION_IDLE_MS), updatedAt: now });
        // Brief 030 P1-6: the moments this receipt names (admitted, said, rendered).
        await receiptMoments(tx, ctx, req, ops);
        // A browser-issued fastO is recorded by the seam from its `admitted` receipt (R9.1).
        if (req.kind === "admitted" && req.permitKind === "fastO") {
          const coreVals = { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev };
          await recordFastO(tx, { uid, stamp: req.stamp, responseId: req.responseId, opsNow: ops, core: coreVals, audience: effectiveAudience(s, ops) }, deps);
        }
        await completeRequest(tx, key, accepted, ops);
        return accepted;
      }),
    ),
  );
}

export const receiptRoute: RouteSpec<ReceiptReq> = {
  name: "receipt",
  parse: ({ body }) => checkReceiptRequest(parseWith(ReceiptRequest, body)),
  run: (ctx, req) => postReceipt(ctx, req),
};
