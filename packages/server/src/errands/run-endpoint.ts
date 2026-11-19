/**
 * `POST /api/errand/run` (owner ruling, Nov 19; `errands/hand-off.ts`): runs one claim of an Errand inside this
 * request and answers when the run has ended, so Cloud Run keeps the CPU on for it. Only this app calls it, with
 * a capability `handOffErrandRun` signed for one owner and one Errand; a browser (any request with an `Origin`) is
 * refused. Answers 200 whether it ran the claim or found nothing to claim.
 */
import type { ID } from "@franki/core";
import { liveRouteDeps } from "../routes/live-deps";
import type { RouteContext, RouteDeps, Schedule } from "../routes/runtime";
import { errandRunBinding } from "./hand-off";
import { runErrandHere } from "./run";

export async function errandRunEndpoint(request: Request, schedule: Schedule, depsIn?: RouteDeps): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (request.headers.get("origin") !== null) return new Response(null, { status: 403 });
  let deps: RouteDeps;
  try {
    deps = depsIn ?? liveRouteDeps();
  } catch {
    return new Response(null, { status: 503 });
  }
  const binding = errandRunBinding(deps, request.headers.get("authorization") ?? "");
  if (binding === null) return new Response(null, { status: 401 });
  const ctx: RouteContext = { uid: binding.uid, deps, schedule, startedOpsAt: deps.clock.read().opsClock.now, origin: null };
  try {
    await runErrandHere(ctx, binding.errandId as ID);
  } catch (error) {
    deps.log("errand.error", { errandId: binding.errandId, error: error instanceof Error ? error.name : "unknown", at: "endpoint" });
    return new Response(null, { status: 500 });
  }
  return Response.json({ ran: true }, { headers: { "cache-control": "no-store" } });
}
