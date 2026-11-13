/**
 * Brief 046 part C: the money read on a typed turn with no call open. The brain model asked for `read_money`; the
 * turn and its admission commit first (as the phone's typed path does, phone/typed.ts), then this reads, puts every
 * note through the Gate, admits the notes under a `tool` rule and replaces the cached response, so a replay answers
 * the same. A replay that lost the model's arguments (the process stopped between the commit and this step) answers
 * one S0 line asking again; it never guesses a question.
 */
import { type ID, type Ledger, type MoneyArgs, type TurnResponse, MONEY_LINES, idParts, tsFromMs, turnRef } from "@franki/core";
import { admitRule } from "../admission/seam";
import { effectiveAudience, hasParseGap } from "../audience";
import { ownerClock, readCoreDocs } from "../core-docs";
import { currentPhoneTurn, phoneTransaction } from "../phone/outbound";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import { gateMoneyResult } from "./money-gate";
import { type MoneyResult, limitMoneyToS0, moneyLineResult, readMoney } from "./money-read";

/** The typed read's budget, the same as the tool route's answer limit (routes/tool.ts TOOL_RESULT_LIMIT_MS). */
export const MONEY_TYPED_BUDGET_MS = 4_500;

export const moneyPendingId = (ctx: RouteContext, stamp: { sessionId: string; turnId: string }) => ctx.deps.hasher.id(["typed-money", ctx.uid, stamp.sessionId, stamp.turnId]);

/** What the typed reply hands the turn route when the brain model asked for a money read. */
export interface MoneyAsk {
  readMoney: MoneyArgs;
}
export const isMoneyAsk = (x: unknown): x is MoneyAsk => typeof x === "object" && x !== null && "readMoney" in x;

export async function finishTypedMoney(ctx: RouteContext, pending: TurnResponse, args: MoneyArgs | null): Promise<TurnResponse> {
  const { deps, uid } = ctx;
  const { stamp, requestId, deck } = pending;
  const noteId = (n: number) => deps.hasher.id(["money-note", stamp.sessionId, stamp.turnId, "typed", n]) as ID;
  const startedAt = deps.clock.read().opsClock.now;
  let read: MoneyResult | null = null;
  if (args !== null) {
    const check = await phoneTransaction(deps.store, uid, (tx) => currentPhoneTurn(tx, uid, stamp));
    if (check !== null) read = (await readMoney(ctx, { turn: check.turn, args, generation: stamp.generation, deadlineAt: startedAt + MONEY_TYPED_BUDGET_MS, noteId })).result;
  }
  const requestEntryId = deps.hasher.id(idParts.request(uid, "turn", requestId));
  return phoneTransaction(deps.store, uid, async (tx) => {
    const row = await tx.get<Extract<Ledger, { kind: "request" }>>(paths.ledger(uid, requestEntryId));
    if (!row || !row.data.payload.response) throw new Error("Missing typed money request");
    const cached = row.data.payload.response as TurnResponse;
    if (cached.pendingId !== pending.pendingId) return cached;
    const current = await currentPhoneTurn(tx, uid, stamp);
    if (!current) return { ...pending, status: "stale", pendingId: null, permit: null, deck: null, notes: [] };
    const core = await readCoreDocs(tx, uid);
    const pair = ownerClock(core.state.data, deps.clock);
    const opsNow = pair.opsClock.now;
    const audience = effectiveAudience(current.session, opsNow);
    const rule = {
      source: "tool" as const,
      transcript: "final" as const,
      judge: "typed" as const,
      parse: { kind: "none" as const },
      regexMatch: false,
      audience,
      narrowedHere: false,
      callLive: false,
      parseGap: hasParseGap(current.session),
      noteSens: "S0" as const,
      wordsPer2s: true,
      allFinal: true,
      toolParseCommitted: true,
      wave: "A" as const,
    };
    const base = read ?? moneyLineResult(ctx, { noteId }, "unclear", MONEY_LINES.lost);
    const gated = await gateMoneyResult(tx, ctx, {
      session: current.session,
      turn: current.turn,
      sessionId: stamp.sessionId as ID,
      turnId: stamp.turnId as ID,
      worldNow: pair.worldClock.now,
      zone: pair.worldClock.zone,
      opsNow,
      epoch: core.epoch.data.epoch,
      policyRev: core.epoch.data.policyRev,
    }, base);
    // The Server_Rule's limit, as on the voice path: private, typed and no gap may carry S1; anything else is S0.
    const allowed = audience === "private" && !rule.parseGap;
    const result = allowed ? gated : limitMoneyToS0(ctx, stamp, gated);
    const admitted = admitRule(tx, {
      uid, requestId, requestEntryId, stamp, turnRef: turnRef(stamp.turnId, stamp.sessionId, current.turn.rev), core: stamp, opsNow,
      head: deck?.head ?? null, notes: result.notes, turns: deck?.turns ?? [], audioIds: [], toolOutput: null, rule,
    }, deps);
    if (admitted.kind !== "permit") throw new Error("Money answer was held");
    const response: TurnResponse = { ...pending, pendingId: null, permit: admitted.permit, notes: admitted.notes, cards: result.cards.slice(0, 2) };
    tx.update(row.path, { ...row.data, updatedAt: tsFromMs(opsNow), payload: { ...row.data.payload, response } });
    return response;
  });
}
