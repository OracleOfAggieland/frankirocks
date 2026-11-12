/**
 * A typed line with no call open, when the route ran (brief 012 G17). The route note is never in `notes`: it goes
 * only into this reply's instructions, and the reply is generated from the Head the plan would commit. The
 * transaction keeps the reply only if the committed plan matches the one it was written from (the `handled` entry
 * and the note kinds); otherwise, or with no reply, the response carries one closed owner-facing line
 * (`typedLine`, `writes/notes.ts`). The whole route stays under `TYPED_ROUTE_BUDGET_MS`, under the page's 10 s.
 */
import { type Head, type ID, type Memory, type OnTurnHandled, type RouteNoteKind, type SafeTurn, type Sens, TYPED_LINES, type W, canonicalJSON, maxSens, tsFromMs, typedLine } from "@franki/core";
import { withDeadline } from "../clock/timers";
import { requireModel } from "../config/models";
import type { ResponsesResult } from "../openai/responses";
import { NOTE_TTL_MS, TYPED_REPLY_DEADLINE_MS, typedReplyRequest } from "../routes/typed-reply";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";

/** G17: the route's total on a typed line with no call open, checked against the page's 10,000 ms. */
export const TYPED_ROUTE_BUDGET_MS = 9_000;

/** The plan a typed reply was written from, compared with the committed one. */
export const planKey = (entry: OnTurnHandled, kinds: readonly RouteNoteKind[]): string => canonicalJSON({ entry, kinds: [...kinds] });

/** The reply from the planned Head, with the route note's text as an instruction; null when missing. */
export async function typedRouteReply(ctx: RouteContext, at: { sessionId: string; turnId: string }, head: Head, noteText: string | null, turns: readonly SafeTurn[], text: string, deadlineMs: number): Promise<W | null> {
  const { uid, deps } = ctx;
  const ms = Math.min(TYPED_REPLY_DEADLINE_MS, deadlineMs);
  if (ms <= 0) return null;
  const instructions = noteText === null ? head.text : `${head.text}\n\nNote for this reply: ${noteText}`;
  let result: ResponsesResult;
  try {
    result = (await withDeadline(deps.openai.call("responses.create", typedReplyRequest(requireModel("brain", deps.env), instructions, turns, text, false)), ms, deps.timers)) as ResponsesResult;
  } catch {
    return null;
  }
  const reply = result.status === "completed" && result.refusal === null ? result.outputText?.trim() : undefined;
  if (reply === undefined || reply.length === 0) return null;
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
  return {
    noteId: deps.hasher.id(["note", at.sessionId, at.turnId]),
    rev: 1,
    kind: "result",
    text: reply.slice(0, 1024),
    rootKeys: [...rootKeys].slice(0, 128),
    dependsOn: [...dependsOn].slice(0, 256),
    sens,
    expiresAt: tsFromMs(deps.clock.read().opsClock.now + NOTE_TTL_MS),
    unprompted: false,
    momentId: null,
    tokens: [],
  };
}

/** The closed owner-facing line for a committed plan, as an S0 note with no roots; null when the table has none. */
export function typedLineNote(kinds: readonly RouteNoteKind[], noteId: ID, expiresAt: string): W | null {
  const text = typedLine(kinds);
  if (text === null) return null;
  return { noteId, rev: 1, kind: "result", text, rootKeys: [], dependsOn: [], sens: "S0", expiresAt, unprompted: false, momentId: null, tokens: [] };
}

/**
 * The closed care line (brief 043, finding 2): the one line a typed turn gets when no reply can be used and nothing
 * committed has a closed line of its own (a life change, a care-only turn). It claims nothing was saved.
 */
export function typedCareNote(noteId: ID, expiresAt: string): W {
  return { noteId, rev: 1, kind: "result", text: TYPED_LINES.care, rootKeys: [], dependsOn: [], sens: "S0", expiresAt, unprompted: false, momentId: null, tokens: [] };
}
