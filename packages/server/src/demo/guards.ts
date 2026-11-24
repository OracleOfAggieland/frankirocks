/**
 * Refusals for a demo visit (brief 054, design "Guards"). A demo visitor is an anonymous Firebase user on the owner's
 * deployment, so the routes that would reach a real bank, a real Google account or a real phone are closed to them.
 * The refusal is the existing 404 SCOPE with no detail, so a probe learns nothing it could not learn from a wrong ID.
 */
import { scopeError } from "../routes/errors";
import type { RouteContext } from "../routes/runtime";

/** Throws SCOPE when the verified token is anonymous. Absent counts as not anonymous (R4.6). */
export function refuseDemo(ctx: Pick<RouteContext, "anonymous">): void {
  if (ctx.anonymous === true) throw scopeError();
}

/** What Franki says when a demo visitor asks him to place a call; no dial and no ledger row follow it (R14.2). */
export const DEMO_PHONE_LINE = "Phone calls aren't available in the demo.";
