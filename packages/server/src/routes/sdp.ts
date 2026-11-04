/**
 * POST /api/session/sdp, the SDP_Proxy (R12; contracts §6 Realtime "persist call first"; design "Call setup").
 *
 *   1. Checks before any OpenAI call: the closed body and a non-empty offer (PARSE), the Session in this tenant
 *      (SCOPE), status `minting` or `active` and the same `generation` (STALE), fewer than 4 registered call IDs
 *      (LIMIT, 409).
 *   2. Posts the offer to `/v1/realtime/calls` with `{type:"realtime", model: FRANKI_VOICE_MODEL, tracing:null,
 *      audio.output.voice:"cedar"}` through the OpenAIPort, using the server-held key.
 *   3. One transaction sets `Session.callId`, appends to `registeredCallIds` and records the request; the answer
 *      is returned only after it commits.
 *   4. If that write fails, the call is hung up at once; a failed hangup keeps retrying in the background
 *      (see `orphanHangup`; contract question 32). A late, failed or Location-less answer is DEPENDENCY, and any
 *      call ID that did arrive is hung up.
 * The route answers within 5 s (R12.7): OpenAI gets at most 3.5 s, the write and any hangup share the rest.
 */
import { type Infer, type Session, SdpRequest, type SdpResponse, tsFromMs } from "@franki/core";
import { SDP_BODY_CAP_BYTES } from "../auth/guard";
import { DeadlineError, withDeadline } from "../clock/timers";
import { requireModel } from "../config/models";
import { ensureCoreDocs } from "../core-docs";
import { completeRequest } from "../ledger/request";
import { callIdFromLocation, callSession, createCall, hangupCall } from "../openai/realtime-calls";
import { SESSION_IDLE_MS } from "../sessions";
import { paths } from "../store/paths";
import { HANGUP_BACKOFF_MS } from "../worker/hangup";
import { RouteError, dependencyError, parseError, scopeError, staleError } from "./errors";
import { mutation } from "./mutation";
import { type RouteContext, type RouteDeps, type RouteSpec, parseWith } from "./runtime";

export const SDP_OPENAI_BUDGET_MS = 3_500;
export const SDP_HANGUP_BUDGET_MS = 1_000;
export const MAX_CALL_IDS = 4;
/** Background hangup retries for a call whose ID could not be stored: 1, 2, 5, 10 s, then every 60 s, for 10 min. */
export const ORPHAN_RETRY_LIMIT_MS = 10 * 60_000;

type SdpReq = Infer<typeof SdpRequest>;
type SdpRes = Infer<typeof SdpResponse>;

export const callLimitError = () => new RouteError("LIMIT", 409, 0, "call ids");

function checkSession(s: Session | null, req: SdpReq): Session {
  if (s === null) throw scopeError();
  if ((s.status !== "minting" && s.status !== "active") || s.generation !== req.generation) throw staleError("session");
  if (s.registeredCallIds.length >= MAX_CALL_IDS) throw callLimitError();
  return s;
}

/**
 * Hangs up a call no Session record knows about. The closed Job schema has no field for a raw Realtime call ID
 * (Job IDs, sourceIds and targets are 43-character IDs), so the retry runs through `schedule`, not a `hangup` Job.
 */
export async function orphanHangup(callId: string, deps: Pick<RouteDeps, "openai" | "timers" | "clock" | "log">): Promise<boolean> {
  const start = deps.clock.read().opsClock.now;
  for (let attempt = 1; ; attempt++) {
    try {
      await withDeadline(hangupCall(deps.openai, callId), 5_000, deps.timers);
      return true;
    } catch {
      if (deps.clock.read().opsClock.now - start >= ORPHAN_RETRY_LIMIT_MS) {
        deps.log("sdp.orphanCall", { callId, attempts: attempt });
        return false;
      }
      await deps.timers.sleep(HANGUP_BACKOFF_MS[attempt - 1] ?? 60_000);
    }
  }
}

/** Hangs up within the route budget; if that fails, keeps retrying after the response. */
async function hangupNowOrLater(ctx: RouteContext, callId: string): Promise<void> {
  const { deps } = ctx;
  try {
    await withDeadline(hangupCall(deps.openai, callId), SDP_HANGUP_BUDGET_MS, deps.timers);
  } catch {
    ctx.schedule(() => orphanHangup(callId, deps));
  }
}

export async function proxySdp(ctx: RouteContext, req: SdpReq): Promise<SdpRes> {
  const { uid, deps } = ctx;
  await ensureCoreDocs(uid, deps);
  return mutation(ctx, "sdp", req.requestId, req, async (key) => {
    checkSession((await deps.store.get<Session>(uid, paths.session(uid, req.sessionId)))?.data ?? null, req);
    const model = requireModel("voice", deps.env);

    const call = createCall(deps.openai, { offerSdp: req.offerSdp, session: callSession(model) });
    let answer: Awaited<typeof call>;
    try {
      answer = await withDeadline(call, SDP_OPENAI_BUDGET_MS, deps.timers);
    } catch (error) {
      if (error instanceof DeadlineError) {
        // A call that is created after the limit is hung up when its answer arrives (R12.10).
        ctx.schedule(() =>
          call.then(
            (late) => {
              const id = callIdFromLocation(late.location);
              return id === null ? undefined : orphanHangup(id, deps);
            },
            () => undefined,
          ),
        );
      }
      throw dependencyError(1000, "realtime.calls.create");
    }
    const callId = callIdFromLocation(answer.location);
    if (callId === null || answer.answerSdp.trim() === "" || answer.answerSdp.length > 65_536) {
      if (callId !== null) await hangupNowOrLater(ctx, callId);
      throw dependencyError(1000, "no call id");
    }

    try {
      return await deps.store.transaction(uid, async (tx) => {
        const doc = await tx.get<Session>(paths.session(uid, req.sessionId));
        const s = checkSession(doc?.data ?? null, req);
        const ops = deps.clock.read().opsClock.now;
        const now = tsFromMs(ops);
        tx.update(doc!.path, {
          ...s,
          callId,
          registeredCallIds: [...s.registeredCallIds, callId],
          expiresAt: tsFromMs(ops + SESSION_IDLE_MS),
          updatedAt: now,
        });
        const response: SdpRes = { answerSdp: answer.answerSdp, sessionId: req.sessionId, generation: req.generation };
        await completeRequest(tx, key, response, ops);
        return response;
      });
    } catch (error) {
      // The call ID is not stored, so nothing else would ever hang it up (R12.4).
      await hangupNowOrLater(ctx, callId);
      if (error instanceof RouteError && error.code !== "DEPENDENCY") throw error;
      throw dependencyError(1000, "call id write");
    }
  });
}

export function checkSdpRequest(req: SdpReq): SdpReq {
  if (req.offerSdp.trim() === "") throw parseError("empty offer");
  return req;
}

export const sdpRoute: RouteSpec<SdpReq> = {
  name: "sdp",
  bodyCap: SDP_BODY_CAP_BYTES,
  parse: ({ body }) => checkSdpRequest(parseWith(SdpRequest, body)),
  run: (ctx, req) => proxySdp(ctx, req),
};
