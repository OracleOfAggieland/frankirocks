/**
 * What Franki is told about the Owner's most recent outbound phone call, so a question about it ("did they pick
 * up?") gets a true answer from the stored carrier observations.
 *
 * This S0 line carries only carrier status. The separate report tool can return private findings.
 */
import { type PhoneStatus, type W, msFromTs, tsFromMs } from "@franki/core";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { PhoneEntry } from "./outbound";
import { carrierOf, storedPhoneStatus } from "./lifecycle";
import { schedulePhoneCheck } from "./reconcile";

/** A nonterminal status remains relevant for this long after its last observation. */
export const PHONE_AWARE_LIVE_MS = 30 * 60_000;
/** A call that is over is mentioned for this long after its terminal observation. */
export const PHONE_AWARE_ENDED_MS = 10 * 60_000;
const NOTE_TTL_MS = 60_000;

const LIVE: readonly PhoneStatus[] = ["dialing", "ringing", "talking", "unknown"];

const STANDS: Record<Exclude<PhoneStatus, "none">, string> = {
  dialing: "is being dialed right now",
  ringing: "is ringing or still connecting to your phone-side self",
  talking: "is connected to your phone-side self right now",
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
    "Carrier status only. Use read_phone_result for the phone specialist's findings. If no report is available, say so. " +
    "Bring the call up only if the owner asks about it.";
}

/** The line for the Owner's latest phone call, or null when there is none recent enough to mention. */
export async function phoneCallLine(ctx: RouteContext, sessionId?: string, epoch?: number): Promise<string | null> {
  const { uid, deps } = ctx;
  const now = deps.clock.read().opsClock.now;
  const rows = await deps.store.query<PhoneEntry>(uid, {
    collection: paths.collection(uid, "ledger"),
    where: [
      { field: "kind", op: "==", value: "phoneCall" },
      ...(sessionId === undefined ? [] : [{ field: "payload.sessionId", op: "==" as const, value: sessionId }]),
    ],
    orderBy: { field: "at", dir: "desc" },
    limit: 1,
  });
  const doc = rows[0];
  if (!doc || doc.data.kind !== "phoneCall" || (epoch !== undefined && doc.data.epoch !== epoch)) return null;
  const row = doc.data;
  const sinceMs = Math.max(0, now - msFromTs(row.at));
  const status = storedPhoneStatus(row, now);
  const lastChange = carrierOf(row)?.observedAt ?? row.updatedAt;
  if (now - msFromTs(lastChange) > (LIVE.includes(status) ? PHONE_AWARE_LIVE_MS : PHONE_AWARE_ENDED_MS)) return null;
  schedulePhoneCheck(ctx, doc.id, row);
  return phoneLineText(status, sinceMs);
}

/** Never throws: a turn is never lost to the phone line. */
export function phoneCallLineSafe(ctx: RouteContext, sessionId: string, epoch: number): Promise<string | null> {
  return phoneCallLine(ctx, sessionId, epoch).catch(() => null);
}

/** The line as an S0 note for a spoken reply's Notes. */
export function phoneNote(ctx: RouteContext, sessionId: string, turnId: string, text: string, opsNow: number): W {
  return {
    noteId: ctx.deps.hasher.id(["phone-status", sessionId, turnId]), rev: 1, kind: "result", text,
    rootKeys: [], dependsOn: [], sens: "S0", expiresAt: tsFromMs(opsNow + NOTE_TTL_MS), unprompted: false, momentId: null, tokens: [],
  };
}
