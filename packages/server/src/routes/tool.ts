/**
 * POST /api/tool. Both tools check the session and wait for its committed turn before acting.
 * Phone calls use a per-turn dial record. The recall path follows R27 and R28.1–R28.3:
 *
 *   1. The closed body, including the closed `recall` args, or PARSE (R27.11). The Session must be this Owner's
 *      (SCOPE).
 *   2. Stamp check: the five Stamp values must be current and `turnId` must be the Session's latest user Turn,
 *      else `stale` with no result (R27.10).
 *   3. Parse wait: the Turn and its Evidence must be committed (`parseState:"committed"`), polled every 100 ms
 *      for at most 1.5 s, else `hold` with no read (R27.2, R27.3).
 *   4. Asked test: the Turn's own words must contain a recall term or alias, else `ready` with empty notes (R27.9).
 *   5. Read: eligible, spoken-grade, non-S2 Memory lines through Q28 (at most 200, 160 characters each), packed to
 *      8,000 tokens, one tool-less RecallAllV1 call on FRANKI_BG_MODEL with up to RECALL_DEADLINE_MS (R27.4). A
 *      failed or late read gives code-ranked excerpts of the same lines (contracts §5 Recall readers), and empty
 *      notes with coverage `unknown` only when none match (R27.7). Statements without supplied citations are
 *      dropped (R27.6).
 *      The `inspect` purpose reads snapshot() instead, with no model call (`recall-inspect.ts`, brief 020).
 *   6. In one transaction, the Admission_Seam (`admitRule`) issues the tool continuation's Permit over a payload that
 *      includes the tool output, its decision is written to the ledger, and the response is recorded (R27.8).
 * The response is sent within TOOL_RESULT_LIMIT_MS (R27.5): the read's deadline shrinks by whatever the parse wait and reads used.
 */
import { narrowedHere } from "../audience-swap";
import { gateToolOutput } from "./gate-tool";
import {
  type Evidence,
  type Infer,
  type Session,
  type Turn,
  ToolRequest,
  type ToolResponse,
  type ToolResult,
  type W,
  RECALL_DEADLINE_MS,
  explicitRequest,
  packRecall,
  recallExcerpts,
  parseRecallOutput,
  recallLines,
  recallNotes,
  recallRequest,
  recallResult,
  type RuleInput,
  serverRule,
  tsFromMs,
  turnRef,
  type ID,
  limitSnapshot,
} from "@franki/core";
import { inspectRecall } from "./recall-inspect";
import { withDeadline } from "../clock/timers";
import { requireModel } from "../config/models";
import { ensureCoreDocs, ownerClock, readCoreDocs } from "../core-docs";
import { currentStamp, issueDeck, sameStamp } from "../deck";
import { foregroundEC, readAllMemories, snapshotFor, storeReader } from "../head-build";
import { completeRequest } from "../ledger/request";
import { admitRule } from "../admission/seam";
import { effectiveAudience, hasParseGap } from "../audience";
import type { ResponsesResult } from "../openai/responses";
import { cachedPhoneTool, replayPhoneTool } from "../phone/replay";
import { readPhoneResult } from "../phone/report";
import { placePhoneCall } from "../phone/outbound";
import { cachedWebTool, replayWebTool } from "../search/replay";
import { reserveWebAnswer } from "../search/delivery";
import { prepareWebSearch, readWebResult, runWebSearchTask, webSearchId, type WebSearchEntry } from "../search/tasks";
// Brief 049 part A.
import { type ErrandPlan, planErrand } from "../errands/start";
import { runErrand } from "../errands/run";
// Brief 046 part C.
import { limitMoneyToS0, readMoney } from "../bank/money-read";
import { answerTool, suggestForAudience, suggestTool } from "./tool-food";
import { recordHeroDeclined } from "../time/answered";
import { paths } from "../store/paths";
import { retryStale } from "../store/errors";
import { barrierError, scopeError } from "./errors";
import { Unrecorded, mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";
import { NOTE_TTL_MS } from "./typed-reply";
import { earlierSafeTurns } from "./turn";

export const PARSE_WAIT_MS = 1_500;
export const PARSE_POLL_MS = 100;
/**
 * The route answers within this limit. Raised from 3 s: reading every Memory and its Evidence from a laptop to
 * us-central1 took most of 3 s before the reader even started, and the client gave up at 3 s, which left Franki
 * silent after "let me check". The client now waits 6 s (voice-client TOOL_TIMEOUT_MS).
 */
export const TOOL_RESULT_LIMIT_MS = 4_500;
/** Time kept back from the route limit for the admission transaction. */
const TOOL_COMMIT_RESERVE_MS = 300;

type ToolReq = Infer<typeof ToolRequest>;
type ToolRes = Infer<typeof ToolResponse>;
type Result = Infer<typeof ToolResult>;

type TurnCheck = { kind: "ok"; turn: Turn } | { kind: "stale" } | { kind: "wait" };

async function checkTurn(ctx: RouteContext, req: ToolReq): Promise<TurnCheck> {
  const { uid, deps } = ctx;
  const s = await deps.store.get<Session>(uid, paths.session(uid, req.stamp.sessionId));
  if (s === null) throw scopeError();
  if (s.data.status !== "minting" && s.data.status !== "active") return { kind: "stale" };
  const reader = storeReader(deps.store, uid);
  const core = await readCoreDocs(reader, uid);
  if (core.epoch.data.barrier !== null) throw barrierError();
  const current = currentStamp(req.stamp.sessionId, s.data.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data });
  if (!sameStamp(req.stamp, current)) return { kind: "stale" };
  const turn = await deps.store.get<Turn>(uid, paths.turn(uid, req.stamp.sessionId, req.stamp.turnId));
  if (turn === null) return { kind: "wait" };
  if (turn.data.role !== "user" || turn.data.seq < s.data.lastClientSeq) return { kind: "stale" };
  return turn.data.parseState === "committed" ? { kind: "ok", turn: turn.data } : { kind: "wait" };
}

/** Below this, the reader is not started and code-ranked excerpts answer instead. */
const MIN_READ_MS = 400;

/**
 * The recall read (steps 4 and 5). Never throws for model problems: a failed, refused, unparsable or late read
 * gives code-ranked excerpts of the same supplied lines (partial coverage), and empty notes only when none match.
 */
async function readRecall(ctx: RouteContext, req: ToolReq, args: Extract<ToolReq["tool"], { name: "recall" }>["args"], turn: Turn, deadlineAt: number): Promise<Result> {
  const { uid, deps } = ctx;
  if (!explicitRequest(turn.text, args)) return recallResult([], "unknown", false);
  if (deadlineAt <= deps.clock.read().opsClock.now) return recallResult([], "unknown", false);

  const reader = storeReader(deps.store, uid);
  const core = await readCoreDocs(reader, uid);
  const pair = ownerClock(core.state.data, deps.clock);
  const rows = await readAllMemories(reader, uid);
  const snapshot = await snapshotFor(reader, uid, rows, core.epoch.data, req.stamp.generation);
  const evidence = new Map<string, Evidence>();
  snapshot.refs.forEach((r, i) => {
    if (r.collection === "evidence") evidence.set(r.id, snapshot.rows[i] as Evidence);
  });
  const ec = { ...foregroundEC(uid, core.epoch.data, pair, req.stamp.generation), explicitRequest: true, turnId: req.stamp.turnId, purpose: args.purpose === "plan" ? ("plan" as const) : ("answer" as const) };
  // Brief 020: `inspect` ("What do you know about me?") is snapshot() with its two recent told lines, no model call.
  if (args.purpose === "inspect") return inspectRecall(rows, { ec: { ...ec, purpose: "inspect" }, snapshot, noteFor: (id) => deps.hasher.id(["note", req.stamp.sessionId, req.stamp.turnId, req.callId, id]) as ID, expiresAt: tsFromMs(deps.clock.read().opsClock.now + NOTE_TTL_MS) });
  const { lines, eligibleCount } = recallLines(rows, ec, snapshot, evidence);
  if (lines.length === 0) return recallResult([], "complete", false);
  const { input, used, truncated } = packRecall(lines, eligibleCount, args.query, args.purpose);
  const noteCtx = {
    noteId: (n: number) => deps.hasher.id(["note", req.stamp.sessionId, req.stamp.turnId, req.callId, n]),
    expiresAt: tsFromMs(deps.clock.read().opsClock.now + NOTE_TTL_MS),
  };
  const excerpts = (): Result => {
    const notes = recallExcerpts(args.query, turn.text, used, noteCtx);
    deps.log("tool.recallExcerpts", { turnId: req.stamp.turnId, notes: notes.length });
    return recallResult(notes, notes.length === 0 ? "unknown" : "partial", truncated);
  };

  const budgetMs = Math.min(RECALL_DEADLINE_MS, deadlineAt - deps.clock.read().opsClock.now);
  if (budgetMs < MIN_READ_MS) return excerpts();
  let out: ResponsesResult;
  try {
    const body = recallRequest(requireModel("bg", deps.env), input);
    out = (await withDeadline(deps.openai.call("responses.create", body), budgetMs, deps.timers)) as ResponsesResult;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "CONFIG") throw error;
    return excerpts();
  }
  const parsed = out.status === "completed" && out.refusal === null ? parseRecallOutput(out.outputText) : null;
  if (parsed === null) return excerpts();
  const notes: W[] = recallNotes(parsed, used, noteCtx);
  return recallResult(notes, truncated ? "partial" : "complete", truncated);
}

export async function postTool(ctx: RouteContext, req: ToolReq): Promise<ToolRes> {
  const dialId = req.tool.name === "read_phone_result" && "dialId" in req.tool.args ? req.tool.args.dialId : undefined;
  const { uid, deps } = ctx;
  await ensureCoreDocs(uid, deps);
  const empty = { stamp: req.stamp, callId: req.callId, result: null, deck: null, permit: null };
  return mutation(ctx, "tool", req.requestId, req, async (key) => {
    const start = deps.clock.read().opsClock.now;
    let check = await checkTurn(ctx, req);
    while (check.kind === "wait" && deps.clock.read().opsClock.now - start < PARSE_WAIT_MS) {
      await deps.timers.sleep(Math.min(PARSE_POLL_MS, PARSE_WAIT_MS - (deps.clock.read().opsClock.now - start)));
      check = await checkTurn(ctx, req);
    }
    // Neither answer is recorded, so a retry with the same requestId runs again.
    if (check.kind === "stale") throw new Unrecorded<ToolRes>({ ...empty, status: "stale" });
    if (check.kind === "wait") throw new Unrecorded<ToolRes>({ ...empty, status: "hold" });

    // Brief 037, finding 1: the food tools answer here and write nothing; their check and write run in the admission.
    const answered =
      req.tool.name === "suggest" ? await suggestTool(ctx, req.stamp, req.tool.args) : req.tool.name === "answer" ? await answerTool(ctx, req.stamp, req.tool.args, check.turn) : null;
    // Brief 049 review fix V9: the errand is planned here and claimed inside the admission's transaction below.
    let errandPlan: ErrandPlan | null = null;
    const result: Result = req.tool.name === "make_phone_call"
      ? { name: "make_phone_call", requestId: req.requestId, message: await placePhoneCall(ctx, req.stamp) }
      : req.tool.name === "read_phone_result" ? { name: "read_phone_result", report: null }
      : req.tool.name === "search_web" ? { name: "search_web", requestId: req.requestId, state: "unavailable" }
      : req.tool.name === "read_web_result" ? { name: "read_web_result", requestId: req.requestId, taskId: null, status: "none", findings: [] }
      : req.tool.name === "suggest" ? answered!.result
      : req.tool.name === "answer" ? answered!.result
      // Brief 046 part C: the money read, on the owner's own committed turn only (bank/money-read.ts).
      : req.tool.name === "read_money" ? (await readMoney(ctx, { turn: check.turn, args: req.tool.args, generation: req.stamp.generation, deadlineAt: start + TOOL_RESULT_LIMIT_MS - TOOL_COMMIT_RESERVE_MS, noteId: (n) => deps.hasher.id(["money-note", req.stamp.sessionId, req.stamp.turnId, req.callId, n]) as ID })).result
      // Brief 049 part A: the errand answers at once; its run is scheduled after the claim (errands/start.ts).
      : req.tool.name === "start_errand" ? (errandPlan = await planErrand(ctx, { stamp: req.stamp, turn: check.turn, args: req.tool.args, noteId: deps.hasher.id(["errand-note", req.stamp.sessionId, req.stamp.turnId, req.callId]) as ID })).result
      : await readRecall(ctx, req, req.tool.args, check.turn, start + TOOL_RESULT_LIMIT_MS - TOOL_COMMIT_RESERVE_MS);

    // Brief 049 review fix V9: the Errand to run, set only when its writes went into a transaction that committed.
    let errandToRun: ID | null = null;
    let searchToRun: ID | null = null;
    const transact = () => deps.store.transaction(uid, async (tx) => {
      errandToRun = null;
      searchToRun = null;
      const doc = await tx.get<Session>(paths.session(uid, req.stamp.sessionId));
      if (doc === null) throw scopeError();
      const s = doc.data;
      const core = await readCoreDocs(tx, uid);
      const ops = deps.clock.read().opsClock.now;
      const current = currentStamp(req.stamp.sessionId, s.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data });
      if (!sameStamp(req.stamp, current) || (s.status !== "minting" && s.status !== "active")) {
        throw new Unrecorded<ToolRes>({ ...empty, status: "stale" });
      }
      // Brief 037, finding 1: the food tools' dinners are checked against the rules read here, and the hero list is
      // written in this transaction, after the Permit.
      const heroWrite = answered?.write == null ? null : await answered.write(tx, core.rules.data);
      if (answered?.write != null && heroWrite === null) throw new Unrecorded<ToolRes>({ ...empty, status: "stale" });
      // Brief 042 item 2: a no to the hero offer is recorded, so the offer closes and is not offered again.
      // Brief 049 review fix V9: the errand's claim reads here, before the first write; it writes only after a Permit.
      const plan = errandPlan as ErrandPlan | null;
      const errandClaim = plan?.kind === "claim" ? await plan.claim(tx, { session: s, epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev, opsNow: ops }) : null;
      const claimed: Result = errandClaim?.result ?? result;
      if (result.name === "answer" && result.state === "declined" && answered?.declinedPendingId !== undefined) await recordHeroDeclined(tx, uid, answered.declinedPendingId, ops, deps.hasher);
      const head = core.bundle.data.head;
      const turn = check.turn;
      const safe = await earlierSafeTurns(tx, uid, req.stamp.sessionId, turn.seq, ctx);
      // V-181: a Session narrowed here gets no Deck and runs the Server_Rule narrowed, as the turn route does.
      const narrowed = narrowedHere(s);
      const deck = head === null || narrowed ? null : issueDeck(current, head, ops, safe);
      // Row 3 of the Server_Rule: the Turn's parse has committed (the wait above). Recall notes are limited to S0
      // unless the Turn could carry S1+ (judge O or typed, private audience, no gap) (R8.11, R12.7).
      const rule: RuleInput = {
        source: "tool",
        transcript: "final",
        // A pasted (T) Turn is not the Owner's own words: its tool output is limited to S0, so it never reads as a
        // typed line here (review of wave A, item 21).
        judge: turn.sourceClass === "T" ? "timeout" : (turn.judge ?? (turn.itemIds.length === 0 ? "typed" : "timeout")),
        parse: { kind: "none" },
        regexMatch: false,
        audience: effectiveAudience(s, ops),
        narrowedHere: narrowed,
        callLive: s.registeredCallIds.length > 0,
        parseGap: hasParseGap(s),
        noteSens: "none",
        wordsPer2s: true,
        allFinal: true,
        toolParseCommitted: true,
        wave: "A",
      };
      const planned = serverRule(rule);
      const limited = claimed.name === "recall" && planned.kind === "permit" && planned.notes !== "all" ? { ...claimed, notes: claimed.notes.filter((n) => n.sens === "S0"), snapshot: claimed.snapshot === null ? null : limitSnapshot(claimed.snapshot, "S0") } : claimed;
      // Brief 045 finding 10: in company (or narrowed here), suggest asks nothing drawn from a Memory and shows only S0.
      let shaped = limited.name === "suggest" ? suggestForAudience(limited, narrowed ? "narrowed" : rule.audience) : limited;
      let searchEntry: WebSearchEntry | null = null;
      if (planned.kind === "permit" && planned.notes === "all" && (req.tool.name === "search_web" || req.tool.name === "read_web_result")) {
        const owner = await tx.get<Turn>(paths.turn(uid, req.stamp.sessionId, req.stamp.turnId));
        if (owner && s.lastClientSeq === owner.data.seq && owner.data.sourceClass === "U" && owner.data.final &&
            owner.data.state !== "dead" && owner.data.parseState === "committed" && (owner.data.itemIds.length === 0 || owner.data.judge === "O")) {
          if (req.tool.name === "read_web_result") shaped = await readWebResult(tx, ctx, req.stamp.sessionId, s, current.epoch, req.requestId);
          else {
            const search = await prepareWebSearch(tx, ctx, req.stamp, s, owner.data, req.tool.args, core.state.data.currentZone, req.requestId);
            shaped = search.result;
            searchEntry = search.entry;
          }
        }
      }
      if (shaped.name === "read_phone_result" && planned.kind === "permit" && planned.notes === "all" &&
          s.lastClientSeq === turn.seq && turn.sourceClass === "U" && (turn.itemIds.length === 0 || turn.judge === "O")) {
        const phone = await readPhoneResult(tx, deps, uid, req.stamp.sessionId, s, current.epoch, dialId);
        if (phone) shaped = { ...shaped, report: phone.report, ...("includeCompletion" in req.tool ? { completion: phone.completion } : {}) };
      }
      // Brief 030 part A: the Gate in front of the result, its rows written here.
      const gated = await gateToolOutput(tx, ctx, { session: s, turn, stamp: req.stamp, core, purpose: req.tool.name === "recall" ? req.tool.args.purpose : null }, shaped);
      // Brief 046 part C: the Server_Rule's S0 limit holds for a money read too, after the Gate has written its rows.
      const output = gated.name === "read_money" && planned.kind === "permit" && planned.notes !== "all" ? limitMoneyToS0(ctx, req.stamp, gated) : gated;
      const admitted = admitRule(
        tx,
        {
          uid,
          requestId: req.requestId,
          requestEntryId: key.keyHash,
          turnRef: turnRef(req.stamp.turnId, req.stamp.sessionId, turn.rev),
          core: { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev },
          stamp: req.stamp,
          head: deck?.head ?? null,
          notes: [],
          turns: deck?.turns ?? [],
          audioIds: turn.itemIds,
          toolOutput: output,
          opsNow: ops,
          rule,
        },
        deps,
      );
      if (admitted.kind === "permit") heroWrite?.();
      if (admitted.kind === "permit" && output.name === "read_web_result" && output.taskId !== null && output.status !== "searching" && output.status !== "none") {
        await reserveWebAnswer(tx, ctx, req.stamp, output.taskId, admitted.permit.permitId);
      }
      if (admitted.kind === "permit" && searchEntry) {
        searchToRun = webSearchId(ctx, req.stamp);
        tx.create(paths.ledger(uid, searchToRun), searchEntry);
      }
      if (admitted.kind === "permit" && errandClaim?.write != null) {
        errandClaim.write(tx);
        errandToRun = errandClaim.errandId;
      }
      const response: ToolRes =
        admitted.kind === "permit"
          ? { stamp: req.stamp, callId: req.callId, status: "ready", result: output, deck, permit: admitted.permit }
          : { ...empty, status: "hold", deck };
      await completeRequest(tx, key, cachedWebTool(cachedPhoneTool(response)), ops);
      return response;
    });
    // Brief 049 ruling 4: the run is scheduled after the commit that created it.
    const response = req.tool.name === "search_web" || req.tool.name === "read_web_result" ? await retryStale(transact) : await transact();
    const run = errandToRun as ID | null;
    if (run !== null) ctx.schedule(() => runErrand(ctx, run));
    const searchId = searchToRun as ID | null;
    if (searchId !== null) ctx.schedule(() => runWebSearchTask(ctx, searchId));
    return response;
  }, (response) => response.result?.name === "read_web_result" ? replayWebTool(ctx, response) : replayPhoneTool(ctx, response, dialId));
}

export const toolRoute: RouteSpec<ToolReq> = {
  name: "tool",
  parse: ({ body }) => parseWith(ToolRequest, body),
  run: (ctx, req) => postTool(ctx, req),
};
