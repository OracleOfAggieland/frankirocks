/**
 * The walked-in tap (brief 044, item 3; spec §14 addition 4, spec line 211: company is set by the owner's words or
 * a tap). `/api/turn` takes a `trustedTap` turn whose `uiControl.verb` is `company` or `alone`, with no text, no
 * items and no target IDs; every other control turn stays refused, as before (`checkTapRequest`).
 *
 * A tap is not a Turn: it carries no words, so no model is called, no Turn, Evidence or Extract_Job is written, and
 * the Session's clientSeq (the order of the owner's words) is left alone (ruling SB-222). It narrows or widens
 * through the same code as the words: the Server_Rule runs on the parse a company or alone line would have (one
 * candidate, chosen, at TAP_P), and `audienceEffect`, `withNarrowHead`, the hangup Job and the Admission_Seam's one
 * decision row follow as in `postTurn`. The answer carries no Deck (the next open or poll brings the new Head).
 *
 * Fails closed:
 *   - a company tap needs only the Session and its generation to be current: a stale view never stops a narrowing;
 *   - an alone tap widens only on a fresh Stamp, as the owner's own line does (ruling SB-223);
 *   - a tap that would set the audience it already has changes nothing ("twice in a row is one change"; SB-224).
 */
import {
  type Au,
  type CoreRules,
  type ID,
  type Infer,
  type RuleInput,
  type Session,
  type TurnRequest,
  type TurnResponse,
  serverRule,
  tsFromMs,
  turnRef,
} from "@franki/core";
import { admitRule } from "../admission/seam";
import { effectiveAudience, expireLease, hasParseGap } from "../audience";
import { audienceEffect, narrowedHere, precompileAudienceHead, withNarrowHead } from "../audience-swap";
import { ensureCoreDocs, ownerClock, readCoreDocs } from "../core-docs";
import { currentStamp, issueDeck } from "../deck";
import type { SlowParse } from "../intents/slow-parse";
import { completeRequest } from "../ledger/request";
import { afterClosed } from "../sessions";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import { driveHangupJob, ensureHangupJob } from "../worker/hangup";
import { barrierError, parseError, staleError } from "./errors";
import { Unrecorded, mutation } from "./mutation";
import { missingSessionError } from "./open-visit";
import type { RouteContext } from "./runtime";
import { statusOf } from "./turn";

type TurnReq = Infer<typeof TurnRequest>;
type TurnRes = Infer<typeof TurnResponse>;

/** The only two taps (spec line 211): someone walked in, and it's just us again. */
export const TAP_VERBS = ["company", "alone"] as const;
export type TapVerb = (typeof TAP_VERBS)[number];
/** The probability a tap's parse gives its one candidate: the owner's own hand, so the surest a parse can be. */
export const TAP_P = 1;
/** Compare-and-set attempts before the route answers STALE, as the turn route. */
const TAP_CAS_ATTEMPTS = 8;

/** A request that is a control turn: a trusted tap or any `uiControl`. */
export const isControlTurn = (req: TurnReq): boolean => req.source === "trustedTap" || req.uiControl !== null;

/** A request `checkTapRequest` let through. */
export const isTap = (req: TurnReq): boolean => req.source === "trustedTap" && req.uiControl !== null && (TAP_VERBS as readonly string[]).includes(req.uiControl.verb);

/** Checks a control turn: only a trusted company or alone tap, with nothing else in it, gets past (brief 044). */
export function checkTapRequest(req: TurnReq): TurnReq {
  if (req.source !== "trustedTap" || req.uiControl === null) throw parseError("control turns are not built");
  if (!(TAP_VERBS as readonly string[]).includes(req.uiControl.verb)) throw parseError("only the company and alone taps are built");
  if (req.uiControl.targetIds.length !== 0) throw parseError("a tap names no targets");
  if (req.transcript !== "" || req.transcriptState !== "final" || req.items.length !== 0) throw parseError("a tap carries no words and no audio");
  if (req.judge !== "typed" || req.pendingId !== null || req.choiceId !== null || req.supersedesRequestId !== null) throw parseError("a tap answers nothing and supersedes nothing");
  return req;
}

/** The parse the owner's own line for this tap would have: one candidate, chosen, as sure as a parse gets. */
export function tapParse(verb: TapVerb): SlowParse {
  return { parse: { kind: "hit", chosen: verb, candidates: [verb], uncertain: false, candidateP: { [verb]: TAP_P } }, regex: [], probabilities: null, ms: 0, invalid: null };
}

/** The audience a tap sets. */
const tapAudience = (verb: TapVerb): Au => (verb === "company" ? "company" : "private");

/** Handles one tap (the turn route's one call into this module). */
export async function postTap(ctx: RouteContext, req: TurnReq): Promise<TurnRes> {
  const { uid, deps } = ctx;
  const verb = req.uiControl!.verb as TapVerb;
  const slow = tapParse(verb);
  await ensureCoreDocs(uid, deps);
  return mutation<TurnRes>(ctx, "turn", req.requestId, req, async (key) => {
    // The Head the tap moves to, compiled before the transaction as a company or alone line's is.
    const audienceHead = await precompileAudienceHead(ctx, slow, req.generation);
    for (let attempt = 1; ; attempt++) {
      try {
        const outcome = await deps.store.transaction(uid, async (tx) => {
          const coreP = readCoreDocs(tx, uid);
          coreP.catch(() => {});
          const doc = await tx.get<Session>(paths.session(uid, req.sessionId));
          if (doc === null) throw missingSessionError((await coreP).state.data);
          const s0 = doc.data;
          const held = narrowedHere(s0);
          if (s0.generation !== req.generation || (s0.status !== "minting" && s0.status !== "active" && !held)) throw staleError("session");
          const core = await coreP;
          if (core.epoch.data.barrier !== null) throw barrierError();
          const pair = ownerClock(core.state.data, deps.clock);
          const ops = pair.opsClock.now;
          const stamp = { ...currentStamp(req.sessionId, s0.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data }), turnId: req.turnId };
          const base: TurnRes = { requestId: req.requestId, stamp, status: "ordinary", deck: null, permit: null, notes: [], cards: [], pendingId: null, question: null, retryAfterMs: 0, receiptId: null, error: null };
          const fresh = req.epoch === stamp.epoch && req.policyRev === stamp.policyRev && req.bundleRev === stamp.bundleRev && req.rulesRev === stamp.rulesRev;
          // SB-223: widening needs the view the owner tapped on to be current; a narrowing never waits for it.
          if (verb === "alone" && !fresh && !held) {
            const head = core.bundle.data.head;
            return { kind: "unrecorded" as const, response: { ...base, status: "stale" as const, deck: head === null ? null : issueDeck(stamp, head, ops) } };
          }
          const s = expireLease(s0, ops);
          const audienceNow = effectiveAudience(s, ops);
          // SB-224: a tap to the audience the Session already has, or on a Session already narrowed here, changes nothing.
          if (held || audienceNow === tapAudience(verb)) {
            await completeRequest(tx, key, base, ops);
            return { kind: "committed" as const, response: base, hangup: null };
          }
          const rule: RuleInput = {
            source: "typed",
            transcript: "final",
            judge: "typed",
            parse: slow.parse,
            regexMatch: false,
            audience: audienceNow,
            narrowedHere: held,
            callLive: s.registeredCallIds.length > 0,
            parseGap: hasParseGap(s),
            noteSens: "none",
            wordsPer2s: true,
            allFinal: true,
            toolParseCommitted: false,
            wave: "B",
          };
          const rules = core.rules.data as CoreRules;
          const aud0 = audienceEffect(serverRule(rule), {
            sessionId: req.sessionId,
            modifiers: s.modifiers,
            epoch: core.epoch.data,
            bundle: core.bundle.data,
            rules,
            opsNow: ops,
            head: audienceHead,
            bundleWritten: false,
            hasher: deps.hasher,
          });
          const aud = await withNarrowHead(tx, uid, aud0, { epoch: core.epoch.data, rules, bundle: core.bundle.data, clock: pair, generation: s0.generation, opsNow: ops, hasher: deps.hasher, bundleWritten: false });
          if (aud !== null) {
            tx.update(paths.core(uid, "epoch"), aud.epoch);
            if (aud.bundle !== null) tx.update(paths.core(uid, "bundle"), aud.bundle);
          }
          const hangup = aud?.hangup === true ? await ensureHangupJob(tx, uid, req.sessionId as ID, s0.rev, ops, deps.hasher) : null;
          const now = tsFromMs(ops);
          tx.update(doc.path, { ...s, ...(aud?.session ?? {}), updatedAt: now });
          const stampOut = aud === null ? stamp : { ...currentStamp(req.sessionId, s0.generation, { epoch: aud.epoch, rules: core.rules.data, bundle: aud.bundle ?? core.bundle.data }), turnId: req.turnId };
          const coreVals = { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev };
          // The Admission_Seam's one decision row records the tap: its request entry and the rule's reason code.
          const admitted = admitRule(
            tx,
            {
              uid,
              requestId: req.requestId,
              requestEntryId: key.keyHash,
              turnRef: turnRef(req.turnId, req.sessionId, 1),
              core: coreVals,
              opsNow: ops,
              stamp: stampOut,
              head: null,
              notes: [],
              turns: [],
              audioIds: [],
              toolOutput: null,
              rule,
            },
            deps,
          );
          const status = statusOf(admitted.outcome);
          const response: TurnRes =
            admitted.kind === "permit" ? { ...base, stamp: stampOut, status, notes: admitted.notes, permit: admitted.permit } : { ...base, stamp: stampOut, status, permit: null };
          await completeRequest(tx, key, response, ops);
          return { kind: "committed" as const, response, hangup };
        });
        if (outcome.kind === "unrecorded") throw new Unrecorded(outcome.response);
        // As a company line's: the narrowing hangs up every registered call after the response.
        const hangupJob = outcome.hangup;
        if (hangupJob !== null) ctx.schedule(() => driveHangupJob(uid, hangupJob, deps, (id) => afterClosed(ctx, id)));
        return outcome.response;
      } catch (error) {
        if (isStoreError(error, "staleRevision") && attempt < TAP_CAS_ATTEMPTS) continue;
        throw error;
      }
    }
  });
}
