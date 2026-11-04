/**
 * POST /api/session/close (R14.2–R14.7; KS07; design "Close"). Sets the Session `closing`, hangs up every
 * registered call ID in parallel within the route budget, then sets `closed` with `closedAt`. A failed or
 * unknown hangup keeps it `closing`, writes one `hangup` Job and answers `closing`. An already closed Session
 * answers `closed` with no hangup and no change. On `closed`, Extract_Jobs are ensured and a drain is scheduled.
 */
import { CloseRequest, type CloseResponse, type Infer, type Session } from "@franki/core";
import { ensureCoreDocs } from "../core-docs";
import { completeRequest } from "../ledger/request";
import { type CloseState, afterClosed, beginCloseInTx, finishCloseInTx } from "../sessions";
import { paths } from "../store/paths";
import { hangupAll } from "../worker/hangup";
import { scopeError, staleError } from "./errors";
import { mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

/** Hangup budget inside the 1.5 s route limit, leaving time for the two transactions. */
export const CLOSE_HANGUP_BUDGET_MS = 1_200;

type CloseReq = Infer<typeof CloseRequest>;
type CloseRes = Infer<typeof CloseResponse>;

export async function closeSession(ctx: RouteContext, req: CloseReq): Promise<CloseRes> {
  const { uid, deps } = ctx;
  await ensureCoreDocs(uid, deps);
  return mutation(ctx, "close", req.requestId, req, async (key) => {
    const begun = await deps.store.transaction(uid, async (tx) => {
      const doc = await tx.get<Session>(paths.session(uid, req.sessionId));
      if (doc === null) throw scopeError();
      if (doc.data.generation !== req.generation) throw staleError("generation");
      const ops = deps.clock.read().opsClock.now;
      if (doc.data.status === "closed" || doc.data.status === "failed") {
        await completeRequest(tx, key, { state: "closed" }, ops);
        return { done: true as const, justClosed: false };
      }
      if (doc.data.status === "closing") return { done: false as const, callIds: [...doc.data.registeredCallIds] };
      const b = await beginCloseInTx(tx, uid, req.sessionId, ops);
      if (b === null || b.closed) {
        await completeRequest(tx, key, { state: "closed" }, ops);
        return { done: true as const, justClosed: true };
      }
      return { done: false as const, callIds: b.callIds };
    });
    if (begun.done) {
      if (begun.justClosed) await afterClosed(ctx, req.sessionId);
      return { state: "closed" };
    }

    const ok = await hangupAll(begun.callIds, deps, CLOSE_HANGUP_BUDGET_MS);
    const state: CloseState = await deps.store.transaction(uid, async (tx) => {
      const ops = deps.clock.read().opsClock.now;
      const s = await finishCloseInTx(tx, uid, req.sessionId, ok, ops, ctx);
      await completeRequest(tx, key, { state: s }, ops);
      return s;
    });
    if (state === "closed") await afterClosed(ctx, req.sessionId);
    return { state };
  });
}

export const closeRoute: RouteSpec<CloseReq> = {
  name: "close",
  parse: ({ body }) => parseWith(CloseRequest, body),
  run: (ctx, req) => closeSession(ctx, req),
};
