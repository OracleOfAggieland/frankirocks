import { type Ledger, type TurnResponse, type W, idParts, tsFromMs, turnRef } from "@franki/core";
import { admitRule } from "../admission/seam";
import { effectiveAudience, hasParseGap } from "../audience";
import { paths } from "../store/paths";
import type { RouteContext } from "../routes/runtime";
import { NOTE_TTL_MS } from "../routes/typed-reply";
import { currentPhoneTurn, phoneTransaction, placePhoneCall } from "./outbound";

/** Replace the committed tool request with an admitted text receipt and cache it for replay. */
export async function finishTypedPhoneCall(ctx: RouteContext, pending: TurnResponse): Promise<TurnResponse> {
  const { deps, uid } = ctx;
  const { stamp, requestId, deck } = pending;
  const message = await placePhoneCall(ctx, stamp);
  const requestEntryId = deps.hasher.id(idParts.request(uid, "turn", requestId));
  return phoneTransaction(deps.store, uid, async (tx) => {
    const row = await tx.get<Extract<Ledger, { kind: "request" }>>(paths.ledger(uid, requestEntryId));
    if (!row || !row.data.payload.response) throw new Error("Missing typed phone request");
    const cached = row.data.payload.response as TurnResponse;
    if (cached.pendingId !== pending.pendingId) return cached;
    const opsNow = deps.clock.read().opsClock.now;
    const current = await currentPhoneTurn(tx, uid, stamp);
    if (!current) return { ...pending, status: "stale", pendingId: null, permit: null, deck: null, notes: [] };
    const note: W = {
      noteId: deps.hasher.id(["phone-result", stamp]), rev: 1, kind: "result", text: message,
      rootKeys: [], dependsOn: [], sens: "S0", expiresAt: tsFromMs(opsNow + NOTE_TTL_MS), unprompted: false, momentId: null, tokens: [],
    };
    const result = admitRule(tx, {
      uid, requestId, requestEntryId, stamp, turnRef: turnRef(stamp.turnId, stamp.sessionId, current.turn.rev), core: stamp, opsNow,
      head: deck?.head ?? null, notes: [note], turns: deck?.turns ?? [], audioIds: [], toolOutput: null,
      rule: { source: "tool", transcript: "final", judge: "typed", parse: { kind: "none" }, regexMatch: false,
        audience: effectiveAudience(current.session, opsNow), narrowedHere: false, callLive: false,
        parseGap: hasParseGap(current.session), noteSens: "S0",
        wordsPer2s: true, allFinal: true, toolParseCommitted: true, wave: "A" },
    }, deps);
    if (result.kind !== "permit") throw new Error("Phone receipt was held");
    const response = { ...pending, pendingId: null, permit: result.permit, notes: result.notes };
    tx.update(row.path, { ...row.data, updatedAt: tsFromMs(opsNow), payload: { ...row.data.payload, response } });
    return response;
  });
}
