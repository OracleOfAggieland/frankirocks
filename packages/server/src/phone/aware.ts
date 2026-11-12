/**
 * What Franki is told about the Owner's most recent outbound phone call, so a question about it ("did they pick
 * up?") gets a true answer. Read-only: the Owner's own `phoneCall` ledger row, then Twilio's status for that call.
 *
 * The line is worded by code and carries no content from the call or from the request: only how long ago the call
 * was placed and where it stands. Nothing said on the call is stored, and the line says so.
 */
import { type PhoneStatus, type W, msFromTs, tsFromMs } from "@franki/core";
import { withDeadline } from "../clock/timers";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { PhoneEntry } from "./outbound";
import { phoneStatusOf, twilioCallStatus } from "./status";
import { phoneConfig } from "./twilio";

/** A call that may still be out is mentioned for this long after the dial. */
export const PHONE_AWARE_LIVE_MS = 30 * 60_000;
/** A call that is over is mentioned for this long after the dial. */
export const PHONE_AWARE_ENDED_MS = 10 * 60_000;
/** The turn never waits longer than this for Twilio's answer. */
export const PHONE_AWARE_STATUS_MS = 1_000;
const NOTE_TTL_MS = 60_000;

const LIVE: readonly PhoneStatus[] = ["dialing", "ringing", "talking", "unknown"];

const STANDS: Record<Exclude<PhoneStatus, "none">, string> = {
  dialing: "is being dialed right now",
  ringing: "is ringing, and nobody has answered yet",
  talking: "is connected right now: the person who answered is talking with your phone-side self",
  ended: "was answered and has now ended",
  busy: "got a busy signal and did not connect",
  noAnswer: "rang out with no answer",
  failed: "did not go through",
  unknown: "was placed, but its current status can't be read right now",
};

const ago = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "less than a minute ago" : minutes === 1 ? "about a minute ago" : `about ${minutes} minutes ago`;
};

export function phoneLineText(status: Exclude<PhoneStatus, "none">, sinceMs: number): string {
  return `Phone call status, from the phone system: the call you placed for the owner ${ago(sinceMs)} ${STANDS[status]}. ` +
    "You can't hear that call and nothing said on it comes back to you, so never guess or make up what was said. " +
    "Bring the call up only if the owner asks about it.";
}

/** The line for the Owner's latest phone call, or null when there is none recent enough to mention. */
export async function phoneCallLine(ctx: RouteContext): Promise<string | null> {
  const { uid, deps } = ctx;
  const now = deps.clock.read().opsClock.now;
  const rows = await deps.store.query<PhoneEntry>(uid, {
    collection: paths.collection(uid, "ledger"),
    where: [
      { field: "kind", op: "==", value: "phoneCall" },
      { field: "at", op: ">=", value: tsFromMs(now - PHONE_AWARE_LIVE_MS) },
    ],
    orderBy: { field: "at", dir: "desc" },
    limit: 1,
  });
  const row = rows[0]?.data;
  if (row === undefined || row.kind !== "phoneCall") return null;
  const sinceMs = Math.max(0, now - msFromTs(row.at));
  let status: Exclude<PhoneStatus, "none">;
  if (row.state === "pending") status = "dialing";
  else if (row.state === "failed") status = "failed";
  else if (row.payload.twilioSid === null) status = "unknown";
  else {
    try {
      const twilio = await withDeadline((deps.callStatus ?? twilioCallStatus)(phoneConfig(deps.env), row.payload.twilioSid), PHONE_AWARE_STATUS_MS, deps.timers);
      const mapped = phoneStatusOf(twilio, row.payload.accepted);
      status = mapped === "none" ? "unknown" : mapped;
    } catch {
      status = "unknown";
    }
  }
  if (!LIVE.includes(status) && sinceMs > PHONE_AWARE_ENDED_MS) return null;
  return phoneLineText(status, sinceMs);
}

/** Never throws: a turn is never lost to the phone line. */
export function phoneCallLineSafe(ctx: RouteContext): Promise<string | null> {
  return phoneCallLine(ctx).catch(() => null);
}

/** The line as an S0 note for a spoken reply's Notes. */
export function phoneNote(ctx: RouteContext, sessionId: string, turnId: string, text: string, opsNow: number): W {
  return {
    noteId: ctx.deps.hasher.id(["phone-status", sessionId, turnId]), rev: 1, kind: "result", text,
    rootKeys: [], dependsOn: [], sens: "S0", expiresAt: tsFromMs(opsNow + NOTE_TTL_MS), unprompted: false, momentId: null, tokens: [],
  };
}
