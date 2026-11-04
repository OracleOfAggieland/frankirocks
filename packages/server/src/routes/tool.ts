/**
 * POST /api/tool, the single-read recall tool (R27; R28.1–R28.3; KC06, KC09, KS01; Q28; design "Tool turn").
 *
 *   1. The closed body, including the closed `recall` args, or PARSE (R27.11). The Session must be this Owner's
 *      (SCOPE).
 *   2. Stamp check: the five Stamp values must be current and `turnId` must be the Session's latest user Turn,
 *      else `stale` with no result (R27.10).
 *   3. Parse wait: the Turn and its Evidence must be committed (`parseState:"committed"`), polled every 100 ms
 *      for at most 1.5 s, else `hold` with no read (R27.2, R27.3).
 *   4. Asked test: the Turn's own words must contain a recall term or alias, else `ready` with empty notes (R27.9).
 *   5. Read: eligible, spoken-grade, non-S2 Memory lines through Q28 (at most 200, 160 characters each), packed to
 *      8,000 tokens, one tool-less RecallAllV1 call on FRANKI_BG_MODEL with a 1.5 s deadline (R27.4). Any failure
 *      gives empty notes with coverage `unknown` (R27.7). Statements without supplied citations are dropped (R27.6).
 *   6. In one transaction, `devAdmit` issues the tool continuation's `slowOrdinary` Permit over a payload that
 *      includes the tool output, its decision is written to the ledger, and the response is recorded (R27.8).
 * The response is sent within 3 s (R27.5): the RecallAllV1 deadline shrinks by whatever the parse wait used.
 */
import {
  type Evidence,
  type Infer,
  type Session,
  type Turn,
  ToolRequest,
  type ToolResponse,
  type ToolResult,
  type W,
  explicitRequest,
  packRecall,
  parseRecallOutput,
  recallLines,
  recallNotes,
  recallRequest,
  recallResult,
  tsFromMs,
  turnRef,
} from "@franki/core";
import { withDeadline } from "../clock/timers";
import { requireModel } from "../config/models";
import { ensureCoreDocs, ownerClock, readCoreDocs } from "../core-docs";
import { currentStamp, issueDeck, sameStamp } from "../deck";
import { foregroundEC, readAllMemories, snapshotFor, storeReader } from "../head-build";
import { completeRequest } from "../ledger/request";
import { admit } from "../admission/seam";
import type { ResponsesResult } from "../openai/responses";
import { paths } from "../store/paths";
import { barrierError, scopeError } from "./errors";
import { Unrecorded, mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";
import { NOTE_TTL_MS } from "./typed-reply";
import { earlierSafeTurns } from "./turn";

export const PARSE_WAIT_MS = 1_500;
export const PARSE_POLL_MS = 100;
export const TOOL_RESULT_LIMIT_MS = 3_000;
/** Time kept back from the 3 s limit for the admission transaction. */
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

/** The recall read (steps 4 and 5). Never throws for model problems: they give empty notes with `unknown`. */
async function readRecall(ctx: RouteContext, req: ToolReq, turn: Turn, budgetMs: number): Promise<Result> {
  const { uid, deps } = ctx;
  const args = req.tool.args;
  if (!explicitRequest(turn.text, args)) return recallResult([], "unknown", false);
  // `inspect` is snapshot() in the contract, which this slice does not build.
  if (args.purpose === "inspect" || budgetMs <= 0) return recallResult([], "unknown", false);

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
  const { lines, eligibleCount } = recallLines(rows, ec, snapshot, evidence);
  if (lines.length === 0) return recallResult([], "complete", false);
  const { input, used, truncated } = packRecall(lines, eligibleCount, args.query, args.purpose);

  let out: ResponsesResult;
  try {
    const body = recallRequest(requireModel("bg", deps.env), input);
    out = (await withDeadline(deps.openai.call("responses.create", body), budgetMs, deps.timers)) as ResponsesResult;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "CONFIG") throw error;
    return recallResult([], "unknown", false);
  }
  const parsed = out.status === "completed" && out.refusal === null ? parseRecallOutput(out.outputText) : null;
  if (parsed === null) return recallResult([], "unknown", false);
  const ops = deps.clock.read().opsClock.now;
  const notes: W[] = recallNotes(parsed, used, {
    noteId: (n) => deps.hasher.id(["note", req.stamp.sessionId, req.stamp.turnId, req.callId, n]),
    expiresAt: tsFromMs(ops + NOTE_TTL_MS),
  });
  return recallResult(notes, truncated ? "partial" : "complete", truncated);
}

export async function postTool(ctx: RouteContext, req: ToolReq): Promise<ToolRes> {
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

    const budget = Math.min(TOOL_RESULT_LIMIT_MS - TOOL_COMMIT_RESERVE_MS - (deps.clock.read().opsClock.now - start), 1_500);
    const result = await readRecall(ctx, req, check.turn, budget);

    return deps.store.transaction(uid, async (tx) => {
      const doc = await tx.get<Session>(paths.session(uid, req.stamp.sessionId));
      if (doc === null) throw scopeError();
      const s = doc.data;
      const core = await readCoreDocs(tx, uid);
      const ops = deps.clock.read().opsClock.now;
      const current = currentStamp(req.stamp.sessionId, s.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data });
      if (!sameStamp(req.stamp, current) || (s.status !== "minting" && s.status !== "active")) {
        throw new Unrecorded<ToolRes>({ ...empty, status: "stale" });
      }
      const head = core.bundle.data.head;
      const turn = check.turn;
      const safe = await earlierSafeTurns(tx, uid, req.stamp.sessionId, turn.seq, ctx);
      const deck = head === null ? null : issueDeck(current, head, ops, safe);
      const admitted = admit(
        tx,
        {
          uid,
          requestId: req.requestId,
          turnRef: turnRef(req.stamp.turnId, req.stamp.sessionId, turn.rev),
          core: { epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev },
          stamp: req.stamp,
          head: deck?.head ?? null,
          notes: [],
          turns: deck?.turns ?? [],
          audioIds: turn.itemIds,
          toolOutput: result,
          turn: { kind: "tool" },
          opsNow: ops,
        },
        deps,
      );
      const response: ToolRes =
        admitted.kind === "permit"
          ? { stamp: req.stamp, callId: req.callId, status: "ready", result, deck, permit: admitted.permit }
          : { ...empty, status: "hold", deck };
      await completeRequest(tx, key, response, ops);
      return response;
    });
  });
}

export const toolRoute: RouteSpec<ToolReq> = {
  name: "tool",
  parse: ({ body }) => parseWith(ToolRequest, body),
  run: (ctx, req) => postTool(ctx, req),
};
