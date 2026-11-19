import { parse as parseForm } from "node:querystring";
import { isIdShape } from "@franki/core";
import { validateRequest } from "twilio/lib/webhooks/webhooks.js";
import { BODY_CAP_BYTES } from "../auth/guard";
import { adminFirestore } from "../config/admin";
import { type Env, requireEnv } from "../config/env";
import { liveRouteDeps } from "../routes/live-deps";
import type { RouteDeps } from "../routes/runtime";
import { paths } from "../store/paths";
import { reportUnconnectedCall } from "./fallback";
import { type CarrierStatus, advanceCarrier, carrierStatus } from "./lifecycle";
import { type PhoneEntry, phoneTransaction } from "./outbound";
import { CALL_SID, CARRIER_CALLBACK_PATH, callbackOrigin } from "./twilio";
import { findPhoneUid } from "./webhook";

interface CarrierEvent { dialId: string; sid: string; status: CarrierStatus }

/** A signed parent-call callback can arrive before the dial POST returns or after its response was lost. */
export async function saveCarrierEvent(deps: RouteDeps, uid: string, event: CarrierEvent): Promise<void> {
  const path = paths.ledger(uid, event.dialId);
  await phoneTransaction(deps.store, uid, async (tx) => {
    const row = (await tx.get<PhoneEntry>(path))?.data;
    if (row?.kind !== "phoneCall" || row.state === "failed" || !("phoneCallId" in row.payload) || row.payload.phoneCallId !== event.dialId) return;
    if (row.payload.twilioSid !== null && row.payload.twilioSid !== event.sid) return;
    const next = advanceCarrier(row, event.status, deps.clock.read().opsClock.now);
    if (next === row && row.state === "complete" && row.payload.twilioSid === event.sid) return;
    tx.update(path, { ...next, state: "complete", payload: { ...next.payload, twilioSid: event.sid } } satisfies PhoneEntry);
  });
}

async function readForm(request: Request) {
  if (Number(request.headers.get("content-length")) > BODY_CAP_BYTES) return null;
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > BODY_CAP_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  // Preserve every POST field, including future fields and repeated names, for Twilio's signature validator.
  return parseForm(Buffer.concat(chunks).toString("utf8"), "&", "=", { maxKeys: 0 });
}

export async function receiveTwilioStatus(request: Request, env: Env, save: (event: CarrierEvent) => Promise<void>): Promise<Response> {
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return new Response(null, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return new Response(null, { status: 415 });
  }
  const url = new URL(request.url);
  const dialId = url.searchParams.get("dialId");
  if (url.pathname !== CARRIER_CALLBACK_PATH || !dialId || !isIdShape(dialId) || url.searchParams.size !== 1) {
    return new Response(null, { status: 400 });
  }
  try {
    const form = await readForm(request);
    if (form === null) return new Response(null, { status: 413 });
    const signedUrl = callbackOrigin(env, url.origin) + url.pathname + url.search;
    if (!validateRequest(requireEnv("TWILIO_AUTH_TOKEN", env), signature, signedUrl, form) ||
        form.AccountSid !== requireEnv("TWILIO_ACCOUNT_SID", env)) return new Response(null, { status: 403 });
    const status = typeof form.CallStatus === "string" ? carrierStatus(form.CallStatus) : null;
    if (!status || typeof form.CallSid !== "string" || !CALL_SID.test(form.CallSid)) return new Response(null, { status: 400 });
    await save({ dialId, sid: form.CallSid, status });
    return new Response(null, { status: 204 });
  } catch {
    // A transient lookup or write failure is retryable. Never log caller numbers or the signed form.
    return new Response(null, { status: 503 });
  }
}

export function twilioStatusWebhook(request: Request): Promise<Response> {
  return receiveTwilioStatus(request, process.env, async (event) => {
    const deps = liveRouteDeps();
    const uid = await findPhoneUid(adminFirestore(deps.env), event.dialId);
    if (uid === null) return;
    await saveCarrierEvent(deps, uid, event);
    // A pickup that ended before Franki got on the line still reports back. A failure here is retried by Twilio.
    if (event.status === "completed") await reportUnconnectedCall(deps, uid, event.dialId);
  });
}
