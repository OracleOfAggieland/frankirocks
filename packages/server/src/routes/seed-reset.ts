/**
 * POST /api/seed/reset (contracts §6 Routes; brief 019 task 5): `{R, sessionId?, fixtureId, visitId}` to
 * `{fixtureNamespace, worldClock, sessionId?}`. Clones the seeded persona into the caller's own tenant: fence, close
 * calls, clear, reseed, unblock. The work is `resetVisit` in ../seed/reset.ts.
 */
import { SeedResetRequest } from "@franki/core";
import { ensureCoreDocs } from "../core-docs";
import { type ResetReq, type ResetRes, resetVisit } from "../seed/reset";
import { mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

export async function seedReset(ctx: RouteContext, req: ResetReq): Promise<ResetRes> {
  await ensureCoreDocs(ctx.uid, ctx.deps);
  return mutation(ctx, "reset", req.requestId, req, (key) => resetVisit(ctx, req, key));
}

export const seedResetRoute: RouteSpec<ResetReq> = {
  name: "reset",
  parse: ({ body }) => parseWith(SeedResetRequest, body),
  run: (ctx, req) => seedReset(ctx, req),
};
