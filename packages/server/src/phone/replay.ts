import { type Infer, type PhoneReport, type Stamp, type ToolResponse, type TurnResponse, payloadHash, msFromTs } from "@franki/core";
import type { RouteContext } from "../routes/runtime";
import { currentPhoneTurn } from "./outbound";
import { readPhoneReport } from "./report";

type ToolRes = Infer<typeof ToolResponse>;
export const phoneReportNoteId = (ctx: RouteContext, stamp: Stamp) => ctx.deps.hasher.id(["phone-report-note", stamp.sessionId, stamp.turnId]);
export const reportText = (report: PhoneReport) => `Phone specialist (${report.outcome}): ${report.summary}`;

/** Persist only the receipt and its hash. A retry may recover the words only while the original permit and report still agree. */
export function cachedPhoneTool(response: ToolRes): ToolRes {
  return response.result?.name === "read_phone_result" && response.result.report
    ? { ...response, result: { ...response.result, report: null } } : response;
}

export function cachedPhoneTurn(ctx: RouteContext, response: TurnResponse): TurnResponse {
  const id = phoneReportNoteId(ctx, response.stamp);
  return response.notes.some((n) => n.noteId === id)
    ? { ...response, notes: response.notes.map((n) => n.noteId === id ? { ...n, text: "" } : n) } : response;
}

async function replaySource(ctx: RouteContext, stamp: Stamp, expiresAt: string) {
  const { uid, deps } = ctx;
  if (msFromTs(expiresAt) <= deps.clock.read().opsClock.now) return null;
  return deps.store.transaction(uid, async (tx) => {
    const current = await currentPhoneTurn(tx, uid, stamp);
    if (!current) return null;
    const report = await readPhoneReport(tx, deps, uid, stamp.sessionId, current.session, stamp.epoch);
    return { report, audioIds: current.turn.itemIds };
  });
}

export async function replayPhoneTool(ctx: RouteContext, response: ToolRes): Promise<ToolRes> {
  if (response.result?.name !== "read_phone_result" || !response.permit) return response;
  const source = await replaySource(ctx, response.stamp, response.permit.expiresAt);
  if (source) {
    const input = { stamp: response.stamp, head: response.deck?.head ?? null, turns: response.deck?.turns ?? [], notes: [], audioIds: source.audioIds };
    for (const report of [source.report, null]) {
      const result = { ...response.result, report };
      if (payloadHash({ ...input, toolOutput: result }, ctx.deps.hasher) === response.permit.approvedPayloadHash) return { ...response, result };
    }
  }
  return { ...response, status: "stale", deck: null, result: null, permit: null };
}

export async function replayPhoneTurn(ctx: RouteContext, response: TurnResponse): Promise<TurnResponse> {
  const id = phoneReportNoteId(ctx, response.stamp);
  if (!response.permit || !response.notes.some((n) => n.noteId === id && n.text === "")) return response;
  const source = await replaySource(ctx, response.stamp, response.permit.expiresAt);
  if (source?.report) {
    const text = reportText(source.report);
    const notes = response.notes.map((n) => n.noteId === id ? { ...n, text } : n);
    const hash = payloadHash({ stamp: response.stamp, head: response.deck?.head ?? null, turns: response.deck?.turns ?? [], notes, audioIds: source.audioIds, toolOutput: null }, ctx.deps.hasher);
    if (hash === response.permit.approvedPayloadHash) return { ...response, notes };
  }
  return { ...response, status: "stale", deck: null, notes: [], permit: null };
}
