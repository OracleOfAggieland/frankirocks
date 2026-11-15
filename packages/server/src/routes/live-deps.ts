/**
 * Live RouteDeps for the Web_App adapters: Firestore_Store, the Admin token verifier, the live Clock_Port and
 * timers, the live OpenAIPort and the HMAC hasher. Built once per process on first use; a missing variable is a
 * ConfigError naming it, which the route returns as CONFIG.
 */
import { adminTokenVerifier } from "../auth/admin-verifier";
import { liveClockPort } from "../clock/live-clock";
import { liveTimers } from "../clock/timers";
import { adminFirestore } from "../config/admin";
import type { Env } from "../config/env";
import { hasherFromEnv } from "../crypto";
import { fastSlotsPort } from "../onturn/fast-slots-port";
import { liveTestTrace } from "../live-test/sink";
import { tracedOpenAI } from "../live-test/trace";
import { liveOpenAI } from "../openai/live";
import { FirestoreStore } from "../store/firestore-store";
import { toRouteError } from "./errors";
import { type HttpInput, type HttpResult, type Log, type RouteDeps, type RouteSpec, type Schedule, runRoute } from "./runtime";

let cached: RouteDeps | null = null;

/**
 * Structured server log: one JSON line, IDs and times only. Brief 050: when the live test recorder is on, the same
 * event is also appended to its `events.ndjson`; what is printed does not change.
 */
export const consoleLog: Log = (event, fields) => {
  console.log(JSON.stringify({ event, ...fields }));
  liveTestTrace(process.env, liveClockPort)?.(event, fields);
};

export function liveRouteDeps(env: Env = process.env): RouteDeps {
  if (cached !== null) return cached;
  const hasher = hasherFromEnv(env);
  // Brief 050: set only when the live test recorder is on; then every model request also traces `model.call`.
  const trace = liveTestTrace(env, liveClockPort) ?? undefined;
  const openai = trace === undefined ? liveOpenAI(env) : tracedOpenAI(liveOpenAI(env), trace, liveClockPort);
  cached = {
    store: new FirestoreStore(adminFirestore(env), hasher),
    clock: liveClockPort,
    hasher,
    openai,
    fastSlots: fastSlotsPort({ openai, timers: liveTimers, clock: liveClockPort, env }),
    env,
    timers: liveTimers,
    tokens: adminTokenVerifier(env),
    log: consoleLog,
    ...(trace === undefined ? {} : { trace }),
  };
  return cached;
}

/** Runs a route on the live deps. A missing config variable becomes CONFIG before any route logic. */
export async function runLiveRoute<Req>(spec: RouteSpec<Req>, http: HttpInput, schedule: Schedule): Promise<HttpResult> {
  let deps: RouteDeps;
  try {
    deps = liveRouteDeps();
  } catch (error) {
    const e = toRouteError(error);
    return { status: e.status, body: e.body };
  }
  return runRoute(spec, http, deps, schedule);
}
