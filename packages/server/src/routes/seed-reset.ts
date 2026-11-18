/**
 * POST /api/seed/reset (contracts §6 Routes; brief 019 task 5): `{R, sessionId?, fixtureId, visitId}` to
 * `{fixtureNamespace, worldClock, sessionId?}`. Clones the seeded persona into the caller's own tenant: fence, close
 * calls, clear, reseed, unblock. The work is `resetVisit` in ../seed/reset.ts.
 */
import { ResetRequest } from "@franki/core";
import { ensureCoreDocs, readCoreDocs } from "../core-docs";
import { type CallStatus, twilioCallStatus } from "../phone/carrier-read";
import { phoneCallOut, phoneOutError } from "../seed/phone-out";
import { type ResetReq, type ResetRes, resetVisit } from "../seed/reset";
import { readSnapshot } from "../store/port";
import { mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

export async function seedReset(ctx: RouteContext, req: ResetReq, callStatus: CallStatus = twilioCallStatus): Promise<ResetRes> {
  // Brief 038 finding 3: a visitor's first reset comes before any open, so its own zone creates the core documents.
  await ensureCoreDocs(ctx.uid, ctx.deps, req.clientZone);
  // Brief 038 finding 10: not while a phone call of this user is still out. Refused before the request entry, so a
  // refusal writes nothing. A real account is answered LIVE by the fence instead, and never reset.
  const core = await readSnapshot(ctx.deps.store, ctx.uid, (r) => readCoreDocs(r, ctx.uid));
  if (core.state.data.clockMode === "fixture" && core.epoch.data.barrier === null && (await phoneCallOut(ctx, callStatus))) throw phoneOutError();
  return mutation(ctx, "reset", req.requestId, req, (key) => resetVisit(ctx, req, key));
}

export function seedResetRouteWith(callStatus: CallStatus): RouteSpec<ResetReq> {
  return {
    name: "reset",
    parse: ({ body }) => parseWith(ResetRequest, body),
    run: (ctx, req) => seedReset(ctx, req, callStatus),
  };
}

export const seedResetRoute: RouteSpec<ResetReq> = seedResetRouteWith(twilioCallStatus);
