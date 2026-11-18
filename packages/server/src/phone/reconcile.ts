import { msFromTs, tsFromMs } from "@franki/core";
import { requireEnv } from "../config/env";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { advanceCarrier, carrierOf, carrierStatus, isTerminalCarrier, PHONE_CARRIER_RETRY_MS, trackedPhonePayload } from "./lifecycle";
import { type PhoneEntry, phoneTransaction } from "./outbound";
import { twilioCallStatus } from "./carrier-read";

const UNAVAILABLE_RETRY_MS = 5 * PHONE_CARRIER_RETRY_MS;
/** The dial can still receive a signed terminal callback after repeated carrier read failures exhaust this window. */
export const PHONE_RECONCILE_WINDOW_MS = 48 * 60 * 60_000;

/** Legacy dials have no due time. Their first read enrolls them in the same retry loop as a new dial. */
function checkDue(row: PhoneEntry, now: number): boolean {
  const carrier = carrierOf(row);
  if (row.state === "failed" || row.payload.twilioSid === null || (carrier && isTerminalCarrier(carrier.status))) return false;
  return !("nextCarrierCheckAt" in row.payload) || (row.payload.nextCarrierCheckAt !== null && row.payload.nextCarrierCheckAt <= tsFromMs(now));
}

/** The due time is also the lease. A crash leaves another check due, and two workers can never start the same due check. */
export async function reconcilePhoneCall(
  store: StorePort, uid: string, dialId: string, now: () => number, readStatus: (sid: string) => Promise<string>,
): Promise<"skipped" | "checked" | "unavailable"> {
  const path = paths.ledger(uid, dialId);
  const claim = await phoneTransaction(store, uid, async (tx) => {
    const doc = await tx.get<PhoneEntry>(path);
    const at = now();
    if (!doc || doc.data.kind !== "phoneCall" || doc.data.uid !== uid || !checkDue(doc.data, at)) return null;
    const payload = trackedPhonePayload(doc.data);
    if (("phoneCallId" in payload && payload.phoneCallId !== dialId) || !payload.twilioSid || !/^CA[0-9a-f]{32}$/i.test(payload.twilioSid)) return null;
    const nextCarrierCheckAt = tsFromMs(at + PHONE_CARRIER_RETRY_MS);
    tx.update(path, { ...doc.data, payload: { ...payload, nextCarrierCheckAt } } satisfies PhoneEntry);
    return { sid: payload.twilioSid, nextCarrierCheckAt };
  });
  if (claim === null) return "skipped";

  const value = await readStatus(claim.sid).catch(() => null);
  const observed = value === null ? null : carrierStatus(value);
  await phoneTransaction(store, uid, async (tx) => {
    const doc = await tx.get<PhoneEntry>(path);
    if (!doc || doc.data.kind !== "phoneCall" || doc.data.uid !== uid || doc.data.payload.twilioSid !== claim.sid) return;
    const payload = trackedPhonePayload(doc.data);
    if (payload.nextCarrierCheckAt !== claim.nextCarrierCheckAt) return;
    const at = now();
    if (observed === null) {
      const deadline = msFromTs(doc.data.at) + PHONE_RECONCILE_WINDOW_MS;
      const nextCarrierCheckAt = at >= deadline ? null : tsFromMs(Math.min(deadline, at + UNAVAILABLE_RETRY_MS));
      tx.update(path, { ...doc.data, payload: { ...payload, nextCarrierCheckAt } } satisfies PhoneEntry);
    } else {
      const next = advanceCarrier(doc.data, observed, at, "poll");
      if (next !== doc.data) tx.update(path, next);
    }
  });
  return observed === null ? "unavailable" : "checked";
}

/** Also lets a local server recover a due call without a running Cloud Scheduler. The request never waits on Twilio. */
export function schedulePhoneCheck(ctx: RouteContext, dialId: string, row: PhoneEntry): void {
  const { uid, deps } = ctx;
  const now = () => deps.clock.read().opsClock.now;
  if (!checkDue(row, now())) return;
  ctx.schedule(async () => {
    const read = async (sid: string) => (deps.callStatus ?? twilioCallStatus)({
      account: requireEnv("TWILIO_ACCOUNT_SID", deps.env), token: requireEnv("TWILIO_AUTH_TOKEN", deps.env),
    }, sid);
    try {
      if (await reconcilePhoneCall(deps.store, uid, dialId, now, read) === "unavailable") deps.log("phone.statusUnavailable", {});
    } catch {
      deps.log("phone.reconcileFailed", {});
    }
  });
}
