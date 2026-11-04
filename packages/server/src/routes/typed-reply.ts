/**
 * Typed reply with no call open (R18.6; contract question 24; design "One typed turn" step 5). One Responses call
 * (FRANKI_BRAIN_MODEL, effort low, store:false, tools:[], the Head text as instructions, the earlier safe turns and
 * the typed text as input, 4 s deadline). The reply comes back as one `W` note with kind `result`: `unprompted:false`,
 * the Head's selected Memories' root keys and dependsOn, and `sens` equal to the highest Sensitivity among them.
 *
 * It runs before the Turn transaction so the note is part of the admitted payload; any failure or timeout gives
 * no note, and the Turn still commits. The call happens only for the request that will commit (its clientSeq is
 * the Session's next), and never on a replay (the request ledger answers first).
 */
import {
  type CoreBundle,
  type ID,
  type Memory,
  type SafeTurn,
  type Sens,
  type Session,
  type TurnRequest,
  type W,
  maxSens,
  tsFromMs,
} from "@franki/core";
import { withDeadline } from "../clock/timers";
import { requireModel } from "../config/models";
import type { ResponsesResult } from "../openai/responses";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import type { RouteContext } from "./runtime";

export const TYPED_REPLY_DEADLINE_MS = 4_000;
export const NOTE_TTL_MS = 60_000;

type Reader = Pick<Tx, "get" | "query">;

/** The Responses request for a typed reply. */
export function typedReplyRequest(model: string, instructions: string, turns: readonly SafeTurn[], text: string) {
  return {
    model,
    reasoning: { effort: "low" },
    store: false,
    tools: [],
    instructions,
    input: [...turns.map((t) => ({ role: t.role, content: t.text })), { role: "user", content: text }],
    max_output_tokens: 512,
  };
}

export async function typedReplyNote(
  ctx: RouteContext,
  req: TurnRequest,
  text: string,
  safeTurns: (reader: Reader) => Promise<SafeTurn[]>,
): Promise<W | null> {
  const { uid, deps } = ctx;
  if (req.source === "asr") return null;
  const session = await deps.store.get<Session>(uid, paths.session(uid, req.sessionId));
  if (session === null || session.data.callId !== null || session.data.nextClientSeq !== req.clientSeq) return null;
  const bundle = await deps.store.get<CoreBundle>(uid, paths.core(uid, "bundle"));
  const head = bundle?.data.head ?? null;
  if (head === null) return null;
  const reader: Reader = { get: (p) => deps.store.get(uid, p), query: (q) => deps.store.query(uid, q) };
  const turns = await safeTurns(reader);

  let result: ResponsesResult;
  try {
    const body = typedReplyRequest(requireModel("brain", deps.env), head.text, turns, text);
    result = (await withDeadline(deps.openai.call("responses.create", body), TYPED_REPLY_DEADLINE_MS, deps.timers)) as ResponsesResult;
  } catch {
    return null;
  }
  const reply = result.status === "completed" && result.refusal === null ? result.outputText?.trim() : undefined;
  if (reply === undefined || reply.length === 0) return null;

  // Roots and dependencies of the Head lines the reply could draw on.
  const rootKeys = new Set<ID>();
  const dependsOn = new Set<string>();
  let sens: Sens = "S0";
  for (const ref of head.selectedRefs) {
    if (ref.type !== "memory") continue;
    const m = await deps.store.get<Memory>(uid, paths.memory(uid, ref.id as ID));
    if (m === null) continue;
    for (const k of m.data.rootKeys) rootKeys.add(k);
    for (const d of m.data.dependsOn) dependsOn.add(d);
    sens = maxSens(sens, m.data.sens);
  }
  const ops = deps.clock.read().opsClock.now;
  return {
    noteId: deps.hasher.id(["note", req.sessionId, req.turnId]),
    rev: 1,
    kind: "result",
    text: reply.slice(0, 1024),
    rootKeys: [...rootKeys].slice(0, 128),
    dependsOn: [...dependsOn].slice(0, 256),
    sens,
    expiresAt: tsFromMs(ops + NOTE_TTL_MS),
    unprompted: false,
    momentId: null,
    tokens: [],
  };
}
