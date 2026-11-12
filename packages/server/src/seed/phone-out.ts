/**
 * Brief 038 finding 10: a reset is refused while a phone call of this user is still out, because the reset deletes
 * the call's ledger row under it and the screen and the webhook then lose the call.
 *
 * "Still out" fails closed. The user's `phoneCall` rows placed within PHONE_OUT_MS (Twilio's default longest call)
 * are read newest first (Q33). A row still `pending`, or `blocked` (Twilio never confirmed the dial), or `complete`
 * with no call ID, is out. A `complete` row is over only when Twilio says the call ended; a status that cannot be
 * read is out. A `failed` dial never rang. A full page of recent rows also counts as out.
 */
import { type Ledger, msFromTs, tsFromMs } from "@franki/core";
import type { CallStatus } from "../phone/status";
import { phoneConfig } from "../phone/twilio";
import { RouteError } from "../routes/errors";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";

/** Twilio's default time limit for one call (4 hours): a call placed earlier than this has ended. */
export const PHONE_OUT_MS = 4 * 3_600_000;
const PAGE = 100;
/** Twilio's words for a call that is over. */
const ENDED = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

/** The answer: 423 BARRIER, as for any operation holding the tenant; the browser shows "Try again". */
export const phoneOutError = () => new RouteError("BARRIER", 423, 5_000, "phoneCall");

type PhoneEntry = Extract<Ledger, { kind: "phoneCall" }>;

/** Whether one of the user's phone calls may still be out. Reads only; never writes. */
export async function phoneCallOut(ctx: RouteContext, callStatus: CallStatus): Promise<boolean> {
  const { uid, deps } = ctx;
  const now = deps.clock.read().opsClock.now;
  const rows = await deps.store.query<PhoneEntry>(uid, {
    collection: paths.collection(uid, "ledger"),
    where: [
      { field: "kind", op: "==", value: "phoneCall" },
      { field: "at", op: ">=", value: tsFromMs(now - PHONE_OUT_MS) },
    ],
    orderBy: { field: "at", dir: "desc" },
    limit: PAGE,
  });
  if (rows.length === PAGE) return true;
  for (const row of rows) {
    const { state, payload } = row.data;
    if (state === "failed") continue;
    if (state !== "complete" || payload.twilioSid === null) return true;
    try {
      // phoneConfig throws without Twilio's settings: then the status cannot be read, and the call counts as out.
      if (!ENDED.has(await callStatus(phoneConfig(deps.env), payload.twilioSid))) return true;
    } catch {
      return true;
    }
  }
  return false;
}
