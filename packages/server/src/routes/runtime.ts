/**
 * The route runtime shared by every adapter (R5.4; design "Routes and error handling"). A Next.js route handler
 * only converts its Request into an HttpInput, calls `runRoute` with the live deps and an `after()`-backed
 * `schedule`, and returns the result as JSON. Everything else (guard, parse, core documents, route logic, error
 * mapping) runs here, independent of the web framework.
 */
import type { ClockPort, Hasher, Schema } from "@franki/core";
import { validate } from "@franki/core";
import { BODY_CAP_BYTES, type TokenVerifier, guardRequest } from "../auth/guard";
import type { Timers } from "../clock/timers";
import type { Env } from "../config/env";
import type { FastSlotsPort } from "../onturn/fast-slots-port";
import type { OpenAIPort } from "../openai/fake";
import type { CallStatus } from "../phone/status";
import type { Dial } from "../phone/twilio";
import type { BankPort } from "../bank/plaid";
import type { GooglePort } from "../google/port";
import type { ForgetResolvePort } from "../forget/resolve-port";
import type { ErrandAgent } from "../errands/agent";
import type { StorePort } from "../store/port";
import { type RouteError, dependencyLogFields, parseError, toRouteError } from "./errors";

/**
 * Hands work to the framework's post-response hook (`after` from next/server in the Web_App). The Server_Library
 * cannot import `next` (R5.3), so adapters pass this in; tests pass one that records work and runs it on demand.
 */
export type Schedule = (work: () => Promise<unknown>) => void;

/** One structured server log line. Callers pass IDs and times only, never content. */
export type Log = (event: string, fields: Record<string, string | number | boolean | string[]>) => void;

export interface RouteDeps {
  dial?: Dial;
  /** Twilio's status for one call, read for the phone line in a reply's notes. Fake in tests. */
  callStatus?: CallStatus;
  /** Brief 046: the bank (Plaid) port. Live when unset; a throwing fake in tests. */
  bank?: BankPort;
  /** Brief 049 (lane google): the Google port. Live when unset; a throwing fake in tests. */
  google?: GooglePort;
  /** Brief 048: the forget job's ForgetResolveV1 port. Over `openai` when unset (`forget/resolve-live.ts`). */
  forgetResolve?: ForgetResolvePort;
  /** Brief 049 part A: the errand agents. The production registry (empty in part A) when unset. */
  errandAgents?: readonly ErrandAgent[];
  store: StorePort;
  clock: ClockPort;
  hasher: Hasher;
  openai: OpenAIPort;
  /** FastSlotsV1 (brief 012): the only way a route calls it. Fake in tests. */
  fastSlots: FastSlotsPort;
  env: Env;
  timers: Timers;
  tokens: TokenVerifier;
  log: Log;
  /**
   * Brief 050: the live test recorder's Log (`events.ndjson`), set only when the recorder is on. New recorder
   * events go through `deps.trace?.(...)`, so production output and every test without it stay as they are.
   */
  trace?: Log;
}

export interface RouteContext {
  uid: string;
  deps: RouteDeps;
  schedule: Schedule;
  /** opsClock time when runRoute started, before the Route_Guard. Routes with a total budget count from it. */
  startedOpsAt?: number;
  /** Brief 049 (lane google): the request's `Origin`, set only on a non-GET request the Route_Guard has passed. */
  origin?: string | null;
}

export interface HttpInput {
  method: string;
  /** Full request URL (query strings are read from it). */
  url: string;
  header(name: string): string | null;
  text(): Promise<string>;
}

export interface HttpResult {
  status: number;
  body: unknown;
}

export interface RouteSpec<Req> {
  /** For logs and caps only. */
  name: string;
  bodyCap?: number;
  /** Builds the request from the parsed JSON body (POST) or the query string (GET). Throws RouteError PARSE. */
  parse(input: { body: unknown; query: URLSearchParams }): Req;
  run(ctx: RouteContext, req: Req): Promise<unknown>;
}

/** Validates against a closed schema, or throws PARSE. */
export function parseWith<T>(schema: Schema<T>, value: unknown): T {
  const result = validate(schema, value);
  if (!result.ok) throw parseError(result.path);
  return result.value;
}

export async function runRoute<Req>(spec: RouteSpec<Req>, http: HttpInput, deps: RouteDeps, schedule: Schedule): Promise<HttpResult> {
  const startedOpsAt = deps.clock.read().opsClock.now;
  let guarded: string | undefined;
  try {
    const bodyText = http.method.toUpperCase() === "GET" ? "" : await http.text();
    const uid = await guardRequest(
      { method: http.method, header: (n) => http.header(n), bodyText, bodyCap: spec.bodyCap ?? BODY_CAP_BYTES },
      deps.tokens,
      undefined,
      deps.log,
    );
    guarded = uid;
    let body: unknown = null;
    if (bodyText !== "") {
      try {
        body = JSON.parse(bodyText);
      } catch {
        throw parseError("body is not JSON");
      }
    }
    const req = spec.parse({ body, query: new URL(http.url).searchParams });
    const origin = http.method.toUpperCase() === "GET" ? null : http.header("origin");
    const result = await spec.run({ uid, deps, schedule, startedOpsAt, origin }, req);
    traceRouteDone(deps, spec.name, http.method, startedOpsAt, guarded, 200, null);
    return { status: 200, body: result };
  } catch (error) {
    const e: RouteError = toRouteError(error);
    if (e.code === "DEPENDENCY") deps.log("route.dependency", { route: spec.name, ...dependencyLogFields(error) });
    traceRouteDone(deps, spec.name, http.method, startedOpsAt, guarded, e.status, e.code);
    return { status: e.status, body: e.body };
  }
}

/** Brief 050: one `route.done` line per request when the recorder is on. It never throws into the route. */
function traceRouteDone(deps: RouteDeps, route: string, method: string, startedOpsAt: number, uid: string | undefined, status: number, code: string | null): void {
  if (deps.trace === undefined) return;
  try {
    deps.trace("route.done", {
      route,
      method: method.toUpperCase(),
      status,
      ...(code === null ? {} : { code }),
      ms: deps.clock.read().opsClock.now - startedOpsAt,
      ...(uid === undefined ? {} : { uid }),
    });
  } catch {
    // The recorder never breaks a request.
  }
}
