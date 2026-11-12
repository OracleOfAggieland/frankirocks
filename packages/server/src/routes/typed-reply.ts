/**
 * Typed reply with no call open (R18.6; contract question 24; design "One typed turn" step 5). One Responses call
 * (FRANKI_BRAIN_MODEL, effort low, store:false, the Head text as instructions, the earlier safe turns and
 * the typed text as input, 4 s deadline). An explicit phone tool call is handled after the turn commits.
 * An ordinary reply comes back as one `W` note with kind `result`: `unprompted:false`,
 * the Head's selected Memories' root keys and dependsOn, and `sens` equal to the highest Sensitivity among them and
 * the earlier safe turns in its input (brief 035, finding 12).
 *
 * It runs before the Turn transaction so the note is part of the admitted payload; any failure or timeout gives
 * no note, and the Turn still commits. The call happens only for the request that will commit (its clientSeq is
 * the Session's next), and never on a replay (the request ledger answers first).
 */
import {
  type CoreBundle,
  type ID,
  type Memory,
  PHONE_TOOL,
  type SafeTurn,
  type Sens,
  type Session,
  type Turn,
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
import { classifyTurn } from "../turns";
import type { RouteContext } from "./runtime";

export const TYPED_REPLY_DEADLINE_MS = 4_000;
export const NOTE_TTL_MS = 60_000;

type Reader = Pick<Tx, "get" | "query">;

/**
 * W-232: what the brain model reads in place of class-T text (a pasted line, or typed text the server classes T), on
 * the turn itself or an earlier one. Worded by code; the third-party text itself is never sent, since no typed line
 * needs it (the reply only acknowledges the paste).
 */
export const PASTED_STAND_IN = "(The owner pasted some text from elsewhere. It isn't shown here. Don't guess what it says; ask what they'd like done with it.)";

/** The earlier turns with every class-T owner turn's text replaced by `PASTED_STAND_IN`; a Turn that can't be read counts as T. */
export async function ownerSafeTurns(reader: Pick<Tx, "get">, uid: string, sessionId: string, turns: readonly SafeTurn[]): Promise<SafeTurn[]> {
  const rows = await Promise.all(turns.map((t) => (t.role === "user" ? reader.get<Turn>(paths.turn(uid, sessionId, t.turnId)) : Promise.resolve(null))));
  return turns.map((t, i) => (t.role !== "user" || rows[i]?.data.sourceClass === "U" ? t : { ...t, text: PASTED_STAND_IN }));
}

/** The Responses request for a typed reply. */
export function typedReplyRequest(model: string, instructions: string, turns: readonly SafeTurn[], text: string, allowPhone: boolean) {
  return {
    model,
    reasoning: { effort: "low" },
    store: false,
    tools: allowPhone ? [{ ...PHONE_TOOL, strict: true }] : [],
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
  allowPhone: boolean,
  phoneLine: Promise<string | null> = Promise.resolve(null),
): Promise<W | "make_phone_call" | null> {
  const { uid, deps } = ctx;
  if (req.source === "asr") return null;
  const session = await deps.store.get<Session>(uid, paths.session(uid, req.sessionId));
  if (session === null || session.data.callId !== null || session.data.nextClientSeq !== req.clientSeq) return null;
  const bundle = await deps.store.get<CoreBundle>(uid, paths.core(uid, "bundle"));
  const head = bundle?.data.head ?? null;
  if (head === null) return null;
  const reader: Reader = { get: (p) => deps.store.get(uid, p), query: (q) => deps.store.query(uid, q) };
  const turns = await ownerSafeTurns(reader, uid, req.sessionId, await safeTurns(reader));
  // W-232: a class-T turn's own text never goes in as the owner's message.
  const said = classifyTurn(req).cls === "T" ? PASTED_STAND_IN : text;

  let result: ResponsesResult;
  try {
    // The Owner's latest phone call, worded by code (phone/aware.ts), so a question about it has a true answer.
    const line = await phoneLine;
    const instructions = line === null ? head.text : `${head.text}

Notes:
- ${line}`;
    const body = typedReplyRequest(requireModel("brain", deps.env), instructions, turns, said, allowPhone && said === text);
    result = (await withDeadline(deps.openai.call("responses.create", body), TYPED_REPLY_DEADLINE_MS, deps.timers)) as ResponsesResult;
  } catch {
    return null;
  }
  if (allowPhone && result.phoneCallRequested && result.status === "completed" && result.refusal === null) return "make_phone_call";
  const reply = result.status === "completed" && result.refusal === null ? result.outputText?.trim() : undefined;
  if (reply === undefined || reply.length === 0) return null;

  // Roots and dependencies of the Head lines the reply could draw on.
  const rootKeys = new Set<ID>();
  const dependsOn = new Set<string>();
  // Brief 035 (finding 12): the earlier safe turns are input too, so the note is as sensitive as the highest of both.
  let sens: Sens = turns.reduce<Sens>((acc, t) => maxSens(acc, t.sens), "S0");
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
