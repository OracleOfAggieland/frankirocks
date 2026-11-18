import { type Infer, type ToolResponse, msFromTs, payloadHash } from "@franki/core";
import { ownerWordsTurn } from "../errands/assignment";
import { currentPhoneTurn } from "../phone/outbound";
import type { RouteContext } from "../routes/runtime";
import { readWebResult } from "./tasks";

type Response = Infer<typeof ToolResponse>;

/** Never put the private question or a copy of its sourced findings in a long-lived request receipt. */
export function cachedWebTool(response: Response): Response {
  return response.result?.name === "read_web_result" && response.result.findings.length
    ? { ...response, result: { ...response.result, findings: [] } } : response;
}

export async function replayWebTool(ctx: RouteContext, response: Response): Promise<Response> {
  if (response.result?.name !== "read_web_result" || !response.permit) return response;
  const { stamp, permit } = response;
  const requestId = response.result.requestId;
  if (msFromTs(permit.expiresAt) > ctx.deps.clock.read().opsClock.now) {
    const valid = await ctx.deps.store.transaction(ctx.uid, async (tx) => {
      const current = await currentPhoneTurn(tx, ctx.uid, stamp);
      if (!current || !ownerWordsTurn(current.turn) || (current.turn.itemIds.length > 0 && current.turn.judge !== "O")) return null;
      const result = await readWebResult(tx, ctx, stamp.sessionId, current.session, stamp.epoch, requestId);
      const hash = payloadHash({ stamp, head: response.deck?.head ?? null, turns: response.deck?.turns ?? [], notes: [], audioIds: current.turn.itemIds, toolOutput: result }, ctx.deps.hasher);
      return hash === permit.approvedPayloadHash ? result : null;
    });
    if (valid) return { ...response, result: valid };
  }
  return { ...response, status: "stale", deck: null, result: null, permit: null };
}
