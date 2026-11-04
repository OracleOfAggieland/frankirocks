/**
 * The idempotent-mutation wrapper used by every non-GET route except `/api/session/state` (R10.8–R10.12).
 * `run` receives the request key and must call `completeRequest(tx, key, response, opsNow)` inside the route's
 * own transaction, so the response is recorded atomically with the route's records.
 */
import type { CoreEpoch, RouteName } from "@franki/core";
import { type RequestKey, beginRequest, releaseRequest, requestKey } from "../ledger/request";
import { paths } from "../store/paths";
import { toRouteError } from "./errors";
import type { RouteContext } from "./runtime";

export async function mutation<R>(
  ctx: RouteContext,
  route: RouteName,
  requestId: string,
  body: unknown,
  run: (key: RequestKey) => Promise<R>,
): Promise<R> {
  const { uid, deps } = ctx;
  const key = requestKey(uid, route, requestId, body, deps.hasher);
  const epoch = await deps.store.get<CoreEpoch>(uid, paths.core(uid, "epoch"));
  const core = { epoch: epoch?.data.epoch ?? 1, policyRev: epoch?.data.policyRev ?? 1 };
  const begin = await beginRequest<R>(uid, key, deps.clock.read().opsClock.now, core, deps);
  if (begin.kind === "replay") return begin.response;
  try {
    return await run(key);
  } catch (error) {
    await releaseRequest(uid, key, toRouteError(error).code, deps.clock.read().opsClock.now, deps);
    throw error;
  }
}
