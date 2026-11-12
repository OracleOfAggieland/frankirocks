/**
 * POST /api/session/close (R14.2–R14.7; KS07; design "Close"; contract question 34). One transaction moves a live
 * Session to `closing`, writes its `hangup` Job and records the answer `closing`, so the browser hears back in
 * a few hundred milliseconds. The hangups then run after the response, with the Job's 1, 2, 5, 10 s backoff;
 * the Job moves the Session to `closed` with `closedAt` once every call is hung up or gone, and tick's Q17 keeps
 * retrying every 60 s after that. A second close while `closing` makes a stuck Job due now (one waiting for a later
 * retry, or one whose lease expired with its runner) and drives it again; a live lease is left to its runner.
 * A Session with no registered call closes at once and answers `closed`, and an already closed Session answers
 * `closed` with no hangup and no change. On `closed`, Extract_Jobs are ensured and a drain is scheduled.
 */
import { CloseRequest, type CloseResponse, type ID, type Infer, type Session, tsFromMs } from "@franki/core";
import { errorCloseCarry } from "../audience-swap";
import { ensureCoreDocs } from "../core-docs";
import { completeRequest } from "../ledger/request";
import { afterClosed, beginCloseInTx } from "../sessions";
import { paths } from "../store/paths";
import { driveHangupJob, ensureHangupJob } from "../worker/hangup";
import { scopeError, staleError } from "./errors";
import { mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

type CloseReq = Infer<typeof CloseRequest>;
type CloseRes = Infer<typeof CloseResponse>;

type Begun = { state: "closed"; justClosed: boolean } | { state: "closing"; jobId: ID };

export async function closeSession(ctx: RouteContext, req: CloseReq): Promise<CloseRes> {
  const { uid, deps } = ctx;
  await ensureCoreDocs(uid, deps);
  return mutation(ctx, "close", req.requestId, req, async (key) => {
    const begun: Begun = await deps.store.transaction(uid, async (tx) => {
      const doc = await tx.get<Session>(paths.session(uid, req.sessionId));
      if (doc === null) throw scopeError();
      if (doc.data.generation !== req.generation) throw staleError("generation");
      const ops = deps.clock.read().opsClock.now;
      if (doc.data.status === "closed" || doc.data.status === "failed") {
        await completeRequest(tx, key, { state: "closed" }, ops);
        return { state: "closed", justClosed: false };
      }
      // Brief 026 (task 51; R14.6): an error close of a non-private Session keeps its audience for the reconnect.
      const carry = errorCloseCarry(doc.data, req.reason, ops);
      if (doc.data.status === "closing" && carry !== null) tx.update(doc.path, { ...doc.data, ...carry, updatedAt: tsFromMs(ops) });
      if (doc.data.status !== "closing") {
        const b = await beginCloseInTx(tx, uid, req.sessionId, ops, undefined, carry ?? {});
        if (b === null || b.closed) {
          await completeRequest(tx, key, { state: "closed" }, ops);
          return { state: "closed", justClosed: true };
        }
      }
      // Written with `closing`, so a crash after this commit still leaves a Job that finishes the close.
      const jobId = await ensureHangupJob(tx, uid, req.sessionId, doc.data.rev, ops, deps.hasher);
      await completeRequest(tx, key, { state: "closing" }, ops);
      return { state: "closing", jobId };
    });
    if (begun.state === "closed") {
      if (begun.justClosed) await afterClosed(ctx, req.sessionId);
      return { state: "closed" };
    }
    ctx.schedule(() => driveHangupJob(uid, begun.jobId, deps, (sessionId) => afterClosed(ctx, sessionId)));
    return { state: "closing" };
  });
}

export const closeRoute: RouteSpec<CloseReq> = {
  name: "close",
  parse: ({ body }) => parseWith(CloseRequest, body),
  run: (ctx, req) => closeSession(ctx, req),
};
