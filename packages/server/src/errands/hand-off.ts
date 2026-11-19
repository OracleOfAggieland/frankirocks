/**
 * Owner ruling, Nov 19 (lane mail-limits): an Errand runs inside a request that stays open.
 *
 * Found on Nov 19 from the live service: App Hosting runs `franki-web` on Cloud Run with
 * `run.googleapis.com/cpu-throttling: "true"` (CPU is allocated only while a request is in flight) and a 300 s
 * request timeout. Every path that starts a run (`/api/tool`, the state poll's pick-up, the tick) does so through
 * `ctx.schedule`, which is Next's `after()`: the work runs once the response has gone, so a run had CPU only while
 * some other request (the call's state poll, once a second) happened to be in flight on the same instance.
 *
 * So `runErrand` hands the run to `POST /api/errand/run` on this app's own public origin
 * (`FRANKI_ERRAND_RUN_ORIGIN`, which must be one of `ALLOWED_ORIGINS`), with a capability bound to the owner and the
 * Errand and signed with the ID key. That request claims and runs the Errand itself and answers only once the run
 * has ended, so Cloud Run keeps the CPU on for the whole run. Unset (tests, local dev), or when the hand-off does
 * not answer 2xx, the run happens where it was scheduled, as before. Either way is safe to repeat: the Job's lease
 * lets one runner claim, and every other finds the Job leased or done and does nothing.
 */
import { timingSafeEqual } from "node:crypto";
import { isIdShape } from "@franki/core";
import { ALLOWED_ORIGINS } from "../auth/guard";
import type { Env } from "../config/env";
import type { RouteContext, RouteDeps } from "../routes/runtime";

/** The path of the in-request runner. */
export const ERRAND_RUN_PATH = "/api/errand/run";
/** The capability must reach the runner this soon after it was made; the run itself takes as long as it takes. */
export const ERRAND_HANDOFF_WINDOW_MS = 60_000;
const PURPOSE = "errand-run-capability";
const UID_CHARS = 128;

export interface ErrandRunBinding {
  uid: string;
  errandId: string;
  until: number;
}

/** This app's public origin for the hand-off, or null when none is configured (the run then stays in-process). */
export function errandRunOrigin(env: Env): string | null {
  const value = env.FRANKI_ERRAND_RUN_ORIGIN;
  if (value === undefined || value === "") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.origin === value && url.username === "" && url.password === "" && ALLOWED_ORIGINS.includes(value) ? value : null;
}

/** The bearer value for one hand-off: the binding, base64url, and its HMAC under the ID key. */
export function errandRunCapability(deps: Pick<RouteDeps, "hasher" | "clock">, uid: string, errandId: string): string {
  const binding: ErrandRunBinding = { uid, errandId, until: deps.clock.read().opsClock.now + ERRAND_HANDOFF_WINDOW_MS };
  const body = Buffer.from(JSON.stringify(binding)).toString("base64url");
  return `${body}.${deps.hasher.id([PURPOSE, body])}`;
}

/** The binding an `Authorization` header carries, or null when it is malformed, forged or past its window. */
export function errandRunBinding(deps: Pick<RouteDeps, "hasher" | "clock">, header: string): ErrandRunBinding | null {
  const match = /^Bearer ([\w-]{1,600})\.([\w-]{43})$/.exec(header);
  if (match === null) return null;
  const expected = Buffer.from(deps.hasher.id([PURPOSE, match[1]]));
  const given = Buffer.from(match[2]!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const b = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")) as Partial<ErrandRunBinding> | null;
    if (b === null || typeof b !== "object") return null;
    if (typeof b.uid !== "string" || b.uid.length === 0 || b.uid.length > UID_CHARS || typeof b.errandId !== "string" || !isIdShape(b.errandId)) return null;
    if (typeof b.until !== "number" || !Number.isSafeInteger(b.until) || b.until <= deps.clock.read().opsClock.now) return null;
    return { uid: b.uid, errandId: b.errandId, until: b.until };
  } catch {
    return null;
  }
}

/**
 * Hands one run to the in-request runner and waits for it to end. True when the runner answered 2xx (it ran the
 * claim, or found nothing to claim); false when no origin is configured or the hand-off failed, so the caller runs
 * it here. Never throws.
 */
export async function handOffErrandRun(ctx: RouteContext, errandId: string, fetchFn: typeof fetch = globalThis.fetch): Promise<boolean> {
  const origin = errandRunOrigin(ctx.deps.env);
  if (origin === null) return false;
  try {
    const res = await fetchFn(`${origin}${ERRAND_RUN_PATH}`, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${errandRunCapability(ctx.deps, ctx.uid, errandId)}`, "content-type": "application/json" },
      body: "{}",
    });
    ctx.deps.log("errand.handOff", { errandId, status: res.status });
    return res.ok;
  } catch (error) {
    ctx.deps.log("errand.handOff", { errandId, error: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}
