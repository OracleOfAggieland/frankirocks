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
  type Au,
  type CoreEpoch,
  type CoreRules,
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
  type TurnWrite,
  type W,
  ROUTE_NOTE_TTL_MS,
  serverRule,
  changesWhatIsSaid,
  idParts,
  msFromTs,
  routeNote,
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
import { type HardRuleResult, type HardRuleRun, applyOpenProposals, executeHardRule } from "../onturn/execute";
import { readOnTurnContext } from "../onturn/context";
import { readSnapshot } from "../store/port";
import { type TypedPlan, planTypedReply, readPreRoute, runHardRuleSlots, typedRouteNote } from "../onturn/route";
import { askedHere, candidateOpens, regexOpens, routeEligible, speakerCertain } from "../onturn/trigger";
import { planKey } from "../onturn/typed";
import { lateSlots, routeHandled } from "../onturn/late";
import { storeReader } from "../head-build";
import { turnEvidenceId } from "../turns";
import { finishTypedPhoneCall } from "../phone/typed";
import { phoneId } from "../phone/outbound";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";
// Brief 026: company, quiet and alone (voice-control tasks 48, 49).
import { audienceEffect, narrowedHere, precompileAudienceHead } from "../audience-swap";
// Brief 035: the review of the audience wave.
import { deckAllowed, lateNarrowing, withNarrowHead } from "../audience-swap";
import { afterClosed } from "../sessions";
import { driveHangupJob, ensureHangupJob } from "../worker/hangup";

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
  const earlier = [...rows].sort((a, b) => turnOrder(a.data, b.data)).filter((row) => row.data.seq < beforeSeq && row.data.evidenceId !== null);
  // The Evidence reads are independent, so they share one round trip; the slow path waits on them after the parse
  // (R23.2). The results keep Turn order.
  const evs = await Promise.all(earlier.map((row) => tx.get<Evidence>(paths.evidence(uid, row.data.evidenceId!))));
  const out: SafeTurn[] = [];
  earlier.forEach((row, i) => {
    const ev = evs[i];
    if (ev === undefined || ev === null) return;
    const s = safeTurn(row.id, row.data, ev.data, row.data.evidenceId!, ctx.deps.hasher);
    if (s !== null) out.push(s);
  });
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
  const typedText = req.transcriptState === "final" ? normalizedTranscript(req.transcript)! : "";
  const cls = classifyTurn(req);
  // Every final ASR transcript and typed U line is parsed (R11.1); pasted T text never is (R8.10). The Decisions
  // call is the slow path's longest wait, so it starts beside ensureCoreDocs and beginRequest (design "One voice
  // turn"; review of wave A, item 23). A replayed request wastes one Decisions call; that is the price.
  const parses = req.supersedesRequestId === null && req.transcriptState === "final" && cls.cls === "U";
  const slowP = parses
    ? (async () => {
        // With no call open, a typed line's parse runs beside its typed reply, which takes longer than 350 ms
        // anyway, so the parse gets 2,000 ms (review of wave A, item 17).
        const noCall = req.source !== "asr" && (await noCallOpen(ctx, req.sessionId));
        const deadlineMs = noCall ? DECISIONS_NO_CALL_DEADLINE_MS : DECISIONS_DEADLINE_MS;
        return runSlowParse({ decisions: decisionsPort(deps), env: deps.env, log: deps.log }, { turnId: req.turnId, utterance: typedText }, deadlineMs);
      })()
    : Promise.resolve(null);
  // A request that fails before it awaits the parse must not leave an unhandled rejection behind.
  slowP.catch(() => {});
  await ensureCoreDocs(uid, deps);
  const result = await mutation<TurnRes>(ctx, "turn", req.requestId, req, async (key) => {
    if (req.supersedesRequestId !== null) return postSupersede(ctx, req, req.supersedesRequestId, key);
    // The on-turn hardRule route (brief 012 design 3.0): RX4 or an asked question at arrival, else a parse candidate.
    const startedAt = deps.clock.read().opsClock.now;
    const arrival = { text: typedText, cls: cls.cls, transcriptState: req.transcriptState, supersedes: false };
    const pre = routeEligible(arrival) ? await readPreRoute(ctx) : null;
    const askedAtArrival = pre === null ? null : askedHere(pre.rules, req.sessionId);
    const regex = regexOpens(arrival);
    const typedNoCall = req.source !== "asr" && cls.cls === "U" && (await noCallOpen(ctx, req.sessionId));
    // G17: with a trigger known at arrival the first typed reply isn't started; a parse-opened route abandons it.
    const replyP =
      typedNoCall && (regex || askedAtArrival !== null)
        ? Promise.resolve(null)
        : typedReplyNote(ctx, req, typedText, (reader) => earlierSafeTurns(reader, uid, req.sessionId, req.clientSeq, ctx), cls.cls === "U" && req.source === "typed");
    replyP.catch(() => {});
    const eid = turnEvidenceId(req.turnId as ID, deps.hasher);
    const routeP =
      pre === null
        ? Promise.resolve(null)
        : runHardRuleSlots(ctx, { eid, text: typedText, typed: req.source !== "asr", regex, askedRuleId: askedAtArrival?.ruleId ?? null, asked: askedAtArrival !== null, pre, generation: req.generation, slowP });
    const [slow, route] = await Promise.all([slowP, routeP]);
    // Open proposals (G39) are applied by every turn transaction; with no route, the context is read for them here.
    const proposalContext =
      route === null && pre !== null && pre.rules.proposals.length > 0 ? await readSnapshot(deps.store, uid, (reader) => readOnTurnContext(reader, uid, pre.epoch, req.generation)) : null;
    const reply = route === null ? await replyP : null;
    // Brief 026: a parse that may narrow or widen the audience compiles that Head before the transaction (design "Alone").
    const audienceHead = await precompileAudienceHead(ctx, slow, req.generation);
    const routeSource = req.source === "asr" ? ("asr" as const) : ("typed" as const);
    const hardRuleRun = (evidence: { eid: string; record: Evidence }, audience: Au): Omit<HardRuleRun, "rules" | "epoch" | "bundle" | "clock"> => ({
      uid,
      sessionId: req.sessionId,
      turnId: req.turnId,
      clientSeq: req.clientSeq,
      generation: req.generation,
      source: routeSource,
      evidence,
      slots: route!.slots,
      trigger: { regex, candidate: candidateOpens(slow), asked: askedAtArrival !== null },
      askedAtArrival,
      speakerCertain: speakerCertain(routeSource, slow),
      context: route!.context,
      audience,
      hasher: deps.hasher,
    });
    let typedPlan: TypedPlan | null = null;
    if (route !== null && typedNoCall && pre !== null) {
      const pair0 = ownerClock(pre.state, deps.clock);
      const rec = userTurnRecords({ uid, sessionId: req.sessionId, req, text: typedText, cls, clock: pair0, core: { epoch: pre.epoch.epoch, policyRev: pre.epoch.policyRev }, hasher: deps.hasher }).evidence;
      const turns = await earlierSafeTurns(storeReader(deps.store, uid), uid, req.sessionId, req.clientSeq, ctx);
      if (rec !== null) typedPlan = await planTypedReply(ctx, hardRuleRun(rec, "private"), pre, turns, startedAt);
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const outcome = await deps.store.transaction(uid, async (tx) => {
          // These three reads are independent, so they share one round trip after the parse (R23.2). They are
          // checked in the order they always were: the Session, then the core documents, then the fastO entry.
          const coreP = readCoreDocs(tx, uid);
          const fastOP = tx.get(paths.ledger(uid, fastODecisionId(deps.hasher, req.sessionId, req.turnId)));
          coreP.catch(() => {});
          fastOP.catch(() => {});
          const doc = await tx.get<Session>(paths.session(uid, req.sessionId));
          if (doc === null) throw scopeError();
          const s0 = doc.data;
          if (s0.generation !== req.generation || (s0.status !== "minting" && s0.status !== "active" && !narrowedHere(s0))) throw staleError("session");
          const core = await coreP;
          if (core.epoch.data.barrier !== null) throw barrierError();
          // Settled before any early answer, so no read is still open when the transaction ends.
          const fastO = await fastOP;
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

          // Brief 026 (row 1; R14.5; property 10, server half): a Session narrowed during itself speaks no more. Every
          // turn on it answers `blocked` with no Permit, whatever it carries; only the hold decision and the answer
          // are written.
          if (narrowedHere(s0)) {
            const closed: RuleInput = {
              source: req.source === "asr" ? "asr" : cls.cls === "T" ? "pasted" : "typed",
              transcript: req.transcriptState,
              judge: req.judge,
              parse: { kind: "none" },
              regexMatch: false,
              audience: effectiveAudience(s0, ops),
              narrowedHere: true,
              callLive: s0.registeredCallIds.length > 0,
              parseGap: hasParseGap(s0),
              noteSens: "none",
              wordsPer2s: false,
              allFinal: false,
              toolParseCommitted: false,
              wave: "B",
            };
            const core0 = { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev };
            admitRule(tx, { uid, requestId: req.requestId, requestEntryId: key.keyHash, turnRef: turnRef(req.turnId, req.sessionId, 1), core: core0, opsNow: ops, stamp, head: null, notes: [], turns: [], audioIds: [], toolOutput: null, rule: closed }, deps);
            const response: TurnRes = { ...base, status: "blocked" };
            await completeRequest(tx, key, response, ops);
            return { kind: "committed" as const, response, jobId: null, repair: null, hangup: null };
          }

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
          let candidateNotes: W[] = reply === null || reply === "make_phone_call" ? [] : [reply];
          const coreVals = { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev };
          const { turn: turn0, evidence } = userTurnRecords({ uid, sessionId: req.sessionId, req, text, cls, clock: pair, core: coreVals, hasher: deps.hasher });

          // The executor (design 3.0): on the rules this transaction read, before anything is admitted.
          const audienceNow = effectiveAudience(s0, ops);
          let hr: HardRuleResult | null = null;
          let write: TurnWrite = { kind: "none" };
          let note: W | null = null;
          if (route !== null && evidence !== null) {
            hr = executeHardRule({ ...hardRuleRun(evidence, audienceNow), rules: core.rules.data as CoreRules, epoch: core.epoch.data, bundle: core.bundle.data, clock: pair });
            tx.update(paths.core(uid, "rules"), hr.rules);
            if (hr.bundle !== null) tx.update(paths.core(uid, "bundle"), hr.bundle);
            if (typedPlan !== null) {
              // G17: no route note in `notes`; one Franki line, the reply only if its plan is the committed one.
              const line = typedRouteNote(ctx, typedPlan, { key: planKey(hr.entry, hr.kinds), kinds: hr.kinds }, { sessionId: req.sessionId, turnId: req.turnId, opsNow: ops });
              candidateNotes = line === null ? [] : [line];
            } else {
              note = routeNote(hr.kinds, { noteId: deps.hasher.id(["routeNote", req.sessionId, req.turnId]), expiresAt: tsFromMs(ops + ROUTE_NOTE_TTL_MS), privateAudience: audienceNow === "private" });
            }
            write = hr.write.kind === "none" ? hr.write : { ...hr.write, note };
          }
          let proposed: { rules: CoreRules; rulesChanged: boolean; bundle: typeof core.bundle.data | null } | null = null;
          if (hr === null && proposalContext !== null) {
            proposed = applyOpenProposals({ uid, rules: core.rules.data as CoreRules, epoch: core.epoch.data, bundle: core.bundle.data, context: proposalContext, clock: pair, audience: audienceNow, generation: req.generation, hasher: deps.hasher });
            if (proposed !== null) {
              tx.update(paths.core(uid, "rules"), proposed.rules);
              if (proposed.bundle !== null) tx.update(paths.core(uid, "bundle"), proposed.bundle);
              // A higher Deck cuts what is playing (G1), so the reply is made from the Head that lists the rules.
              if (proposed.rulesChanged) write = { kind: "committed", routes: ["hardRule"], note: null, deckRaised: true };
            }
          }
          const changed = hr ?? proposed;
          const stampOut = changed?.rulesChanged ? { ...currentStamp(req.sessionId, s0.generation, { epoch: core.epoch.data, rules: changed.rules, bundle: changed.bundle ?? core.bundle.data }), turnId: req.turnId } : stamp;
          const headOut = changed?.bundle?.head ?? head;

          // The parse and the verdict go on the Turn (R13.2; question 57); its Slice says its Sensitivity (question 61).
          const parsed = slow !== null && slow.parse.kind !== "failed";
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
          const transcriptState = req.transcriptState;
          const rule: RuleInput = {
            source: req.source === "asr" ? "asr" : cls.cls === "T" ? "pasted" : "typed",
            transcript: transcriptState,
            // A fastO already admitted for this Turn means the verdict was O, whatever the request said: a turn posted
            // before its verdict says `timeout` (question 56). Review of the live run, item 5.
            judge: fastO !== null ? "O" : req.judge,
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
            wave: "B",
          };
          // Brief 026 (tasks 48, 49): the audience effects of the rule's outcome, written in this transaction. The rule is
          // pure, so it runs here once more to choose them; the seam below runs it again on the same input.
          // A wave B route that fires changes what is said, so it raises policyRev (KV05; design "Audience effects").
          const routed = rule.parse.kind === "hit" && changesWhatIsSaid(rule.parse, rule.judge, "B");
          const raisedEpoch: CoreEpoch | null = routed ? { ...core.epoch.data, policyRev: core.epoch.data.policyRev + 1, updatedAt: tsFromMs(ops) } : null;
          const aud = audienceEffect(serverRule(rule), {
            sessionId: req.sessionId,
            raisedEpoch,
            modifiers: s.modifiers,
            epoch: core.epoch.data,
            bundle: changed?.bundle ?? core.bundle.data,
            rules: changed?.rules ?? (core.rules.data as CoreRules),
            opsNow: ops,
            head: audienceHead,
            bundleWritten: (changed?.bundle ?? null) !== null,
            hasher: deps.hasher,
          });
          if (aud !== null) {
            tx.update(paths.core(uid, "epoch"), aud.epoch);
            if (aud.bundle !== null) tx.update(paths.core(uid, "bundle"), aud.bundle);
          }
          const hangup = aud?.hangup === true ? await ensureHangupJob(tx, uid, req.sessionId as ID, s0.rev, ops, deps.hasher) : null;
          const stampOut2 =
            aud === null
              ? stampOut
              : { ...currentStamp(req.sessionId, s0.generation, { epoch: aud.epoch, rules: changed?.rulesChanged ? changed.rules : core.rules.data, bundle: aud.bundle ?? (changed?.rulesChanged ? (changed.bundle ?? core.bundle.data) : core.bundle.data) }), turnId: req.turnId };
          const headOut2 = aud?.bundle?.head ?? headOut;
          const now = tsFromMs(ops);
          tx.update(doc.path, {
            ...next,
            ...(aud?.session ?? {}),
            nextClientSeq: req.clientSeq + 1,
            lastClientSeq: req.clientSeq,
            committedParseSeq,
            lastTurnAt: now,
            lastUserTurnOpsAt: now,
            expiresAt: tsFromMs(ops + SESSION_IDLE_MS),
            committedItemIds: [...s.committedItemIds, ...turn.itemIds].slice(-64),
            updatedAt: now,
          });

          const deck = headOut2 === null ? null : issueDeck(stampOut2, headOut2, ops, safe);
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
              stamp: stampOut2,
              head: deck?.head ?? null,
              notes: candidateNotes,
              turns: deck?.turns ?? [],
              audioIds: turn.itemIds,
              toolOutput: null,
              rule,
              write,
              routeNote: note,
            },
            deps,
          );
          const status = statusOf(admitted.outcome);
          const response: TurnRes = admitted.kind === "permit" ? { ...base, stamp: stampOut2, status, deck, notes: admitted.notes, permit: admitted.permit } : { ...base, stamp: stampOut2, status, deck, permit: null };
          if (reply === "make_phone_call" && admitted.kind === "permit" && admitted.permit.scope === "reply" && admitted.permit.kind !== "recoveryOnly") {
            response.pendingId = phoneId(ctx, stampOut2);
          }
          await completeRequest(tx, key, response, ops);
          return { kind: "committed" as const, response, jobId, repair, hangup };
        });
        if (outcome.kind === "unrecorded") throw new Unrecorded(outcome.response);
        // Extraction and the Parse_Repair start after the response is sent (R18.4, R22.12, R15.3).
        if (outcome.repair !== null) {
          const target = { sessionId: req.sessionId as ID, turnId: req.turnId as ID, token: outcome.repair };
          ctx.schedule(() => runParseRepair(uid, deps, target));
        }
        if (outcome.jobId !== null) ctx.schedule(() => drainExtractJobs(uid, deps));
        // Brief 026 (task 48): a narrowing hangs up every registered call after the response, with the Job's backoff.
        const hangupJob = outcome.hangup;
        if (hangupJob !== null) ctx.schedule(() => driveHangupJob(uid, hangupJob, deps, (id) => afterClosed(ctx, id)));
        return outcome.response;
      } catch (error) {
        // A lost compare-and-set: handle the request again against the new nextClientSeq (R19.11).
        if (isStoreError(error, "staleRevision") && attempt < MAX_CAS_ATTEMPTS) continue;
        throw error;
      }
    }
  });
  // The original turn and its admission must commit before any external dial. Replays
  // can resume this step if the process stopped between the commit and the HTTP response.
  return result.pendingId !== null && result.pendingId === phoneId(ctx, result.stamp) ? finishTypedPhoneCall(ctx, result) : result;
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
  // The missing post may still be running, or not be visible yet: a retryable hold, nothing recorded (review item 19).
  if (first === null || (first.data.kind === "request" && first.data.state === "pending")) {
    const ss = { sessionId: req.sessionId, epoch: req.epoch, policyRev: req.policyRev, bundleRev: req.bundleRev, rulesRev: req.rulesRev, generation: req.generation, turnId: req.turnId };
    throw new Unrecorded({ requestId: req.requestId, stamp: ss, status: "hold", deck: null, permit: null, notes: [], cards: [], pendingId: null, question: null, retryAfterMs: HOLD_RETRY_MS, receiptId: null, error: null });
  }
  if (first.data.kind !== "request" || first.data.state !== "complete" || firstTurnId !== req.turnId) throw parseError("supersedesRequestId names no completed request for this turn");

  const text = normalizedTranscript(req.transcript)!;
  const cls = classifyTurn(req);
  const slow = await runSlowParse({ decisions: decisionsPort(deps), env: deps.env, log: deps.log }, { turnId: req.turnId, utterance: text });
  // Brief 012 G20 (task B9): the hardRule route only, once per turn, planned in this post's own transaction.
  const late = await lateSlots(ctx, { turnId: req.turnId, text, cls: cls.cls, typed: false, slow, generation: req.generation });
  // Brief 035 (finding 2): a late company or quiet hit narrows; its Head is compiled before the transaction.
  const audienceHead = await precompileAudienceHead(ctx, slow, req.generation);
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
        const head0 = core.bundle.data.head;
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
        if (!fresh) return { kind: "unrecorded" as const, response: { ...base, status: "stale" as const, deck: head0 === null ? null : issueDeck(stamp0, head0, ops) } };

        // The Turn must still wait for this transcript: same seq, same items; else stale with no writes.
        const turnDoc = await tx.get<Turn>(paths.turn(uid, req.sessionId, req.turnId));
        const itemIds = [...req.items].sort((a, b) => a.commitSeq - b.commitSeq).map((i) => i.itemId);
        const t0 = turnDoc?.data;
        const sameItems = t0 !== undefined && t0.itemIds.length === itemIds.length && t0.itemIds.every((id, n) => id === itemIds[n]);
        if (t0 === undefined || t0.role !== "user" || t0.state !== "transcriptMissing" || t0.seq !== req.clientSeq || !sameItems) {
          return { kind: "unrecorded" as const, response: { ...base, status: "stale" as const } };
        }

        // A hit whose route changes what is said and fires runs as a late hit: policyRev + 1, so the next Deck cancels
        // older speech (KV05; R15.5). A weak one with judge O doesn't (review of the live run, item 5).
        const fastO = await tx.get(paths.ledger(uid, fastODecisionId(deps.hasher, req.sessionId, req.turnId)));
        const judge = fastO !== null ? "O" : req.judge;
        // Brief 035 (finding 2): a company or quiet hit narrows here as it would on the turn (lateNarrowing).
        const narrowing = await withNarrowHead(tx, uid, lateNarrowing({ sessionId: req.sessionId, session: s0, parse: slow.parse, judge, epoch: core.epoch.data, bundle: core.bundle.data, rules: core.rules.data as CoreRules, opsNow: ops, head: audienceHead, hasher: deps.hasher }), { epoch: core.epoch.data, rules: core.rules.data as CoreRules, bundle: core.bundle.data, clock: pair, generation: s0.generation, opsNow: ops, hasher: deps.hasher });
        const hit = narrowing === null && slow.parse.kind === "hit" && changesWhatIsSaid(slow.parse, judge, "A");
        const epoch: CoreEpoch = narrowing?.epoch ?? (hit ? { ...core.epoch.data, policyRev: core.epoch.data.policyRev + 1, updatedAt: tsFromMs(ops) } : core.epoch.data);
        if (hit || narrowing !== null) tx.update(paths.core(uid, "epoch"), epoch);
        const coreVals = { epoch: epoch.epoch, policyRev: epoch.policyRev };

        const { evidence } = userTurnRecords({ uid, sessionId: req.sessionId, req, text, cls, clock: pair, core: coreVals, hasher: deps.hasher });
        const ev = evidence!;
        // Task B9: the executor on the rules this transaction read, unless the route already ran for this Evidence.
        const lateHr = late === null || routeHandled(core.rules.data as CoreRules, ev.eid) ? null : executeHardRule({
          uid,
          sessionId: req.sessionId,
          turnId: req.turnId,
          clientSeq: req.clientSeq,
          generation: req.generation,
          source: "asr",
          rules: core.rules.data as CoreRules,
          epoch,
          bundle: core.bundle.data,
          evidence: ev,
          slots: late.run.slots,
          trigger: { regex: late.regex, candidate: candidateOpens(slow), asked: false },
          askedAtArrival: null,
          speakerCertain: speakerCertain("asr", slow),
          context: late.run.context,
          clock: pair,
          audience: effectiveAudience(s0, ops),
          hasher: deps.hasher,
        });
        if (lateHr !== null) {
          tx.update(paths.core(uid, "rules"), lateHr.rules);
          if (lateHr.bundle !== null) tx.update(paths.core(uid, "bundle"), lateHr.bundle);
        }
        const rulesOut = lateHr?.rules ?? core.rules.data;
        // Brief 035: the narrow Head, unless the hardRule route wrote core/bundle (compiled with the unknown audience
        // of the missing transcript's lease, which takes S0 only).
        const narrowBundle = lateHr?.bundle == null ? (narrowing?.bundle ?? null) : null;
        if (narrowBundle !== null) tx.update(paths.core(uid, "bundle"), narrowBundle);
        const hangupJob = narrowing?.hangup === true ? await ensureHangupJob(tx, uid, req.sessionId as ID, s0.rev, ops, deps.hasher) : null;
        const bundleOut = lateHr?.bundle ?? narrowBundle ?? core.bundle.data;
        const stamp = { ...currentStamp(req.sessionId, s0.generation, { epoch, rules: rulesOut, bundle: bundleOut }), turnId: req.turnId };
        const head = bundleOut.head;
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
        // A committed parse closes this Turn's own gap, `alone` included; it never closes another Turn's (R15.8;
        // review of wave A, item 20). A failed parse is `unknown` (R15.6).
        let committedParseSeq = s.committedParseSeq;
        if (!parsed) s = { ...s, audience: "unknown" };
        else committedParseSeq = await advancedWatermark(tx, uid, req.sessionId, s, req.clientSeq);
        tx.update(doc.path, { ...s, ...(narrowing?.session ?? {}), committedParseSeq, lastTurnAt: now, expiresAt: tsFromMs(ops + SESSION_IDLE_MS), updatedAt: now });

        const safe = await earlierSafeTurns(tx, uid, req.sessionId, req.clientSeq, ctx);
        const deck = head === null || !deckAllowed(lateHr?.bundle == null ? narrowing : null) ? null : issueDeck(stamp, head, ops, safe);
        // A rules write raises the Deck, which cuts what is playing (G1), as a late hit does. A narrowing that hangs
        // up answers blocked, so the browser swaps (brief 035).
        const status = narrowing?.hangup === true ? "blocked" : hit || narrowing !== null || lateHr?.rulesChanged === true ? "ready" : "ordinary";
        const response: TurnRes = { ...base, stamp, status, deck };
        await completeRequest(tx, key, response, ops);
        return { kind: "committed" as const, response, jobId, hangupJob };
      });
      if (outcome.kind === "unrecorded") throw new Unrecorded(outcome.response);
      ctx.schedule(() => drainExtractJobs(uid, deps));
      const hangupJob = outcome.hangupJob;
      if (hangupJob !== null) ctx.schedule(() => driveHangupJob(uid, hangupJob, deps, (id) => afterClosed(ctx, id)));
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
