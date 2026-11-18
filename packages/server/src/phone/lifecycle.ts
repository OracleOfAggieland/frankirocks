import {
  PHONE_CARRIER_STATUSES, type CarrierStatus, type Hasher, type PhoneCompletion, type PhoneReport, type PhoneStatus, msFromTs, tsFromMs,
} from "@franki/core";
import type { PhoneEntry } from "./outbound";

export type { CarrierStatus } from "@franki/core";
export const dialIdForTurn = (hasher: Hasher, uid: string, sessionId: string, turnId: string) =>
  hasher.id(["outbound-phone", uid, sessionId, turnId]);
export const PHONE_SUBMISSION_WINDOW_MS = 10_000;
export const PHONE_REPORT_GRACE_MS = 15_000;
export const PHONE_CARRIER_RETRY_MS = 60_000;

const phase: Record<CarrierStatus, number> = {
  queued: 0, initiated: 1, ringing: 2, "in-progress": 3,
  completed: 4, busy: 4, "no-answer": 4, failed: 4, canceled: 4,
};

export function carrierStatus(value: string): CarrierStatus | null {
  return PHONE_CARRIER_STATUSES.find((status) => status === value) ?? null;
}

export const isTerminalCarrier = (status: CarrierStatus): boolean => phase[status] === phase.completed;

export function trackedPhonePayload(row: PhoneEntry) {
  return "carrier" in row.payload ? row.payload : { ...row.payload, carrier: null, nextCarrierCheckAt: null };
}

export const carrierOf = (row: PhoneEntry) => "carrier" in row.payload ? row.payload.carrier : null;

/** A signed callback and a carrier status read may arrive in either order. The first terminal observation fixes the grace deadline. */
export function advanceCarrier(row: PhoneEntry, status: CarrierStatus, nowMs: number, source: "event" | "poll" = "event"): PhoneEntry {
  const payload = trackedPhonePayload(row);
  const observedAt = tsFromMs(nowMs);
  if (payload.carrier && phase[status] <= phase[payload.carrier.status]) {
    // Only a fresh status GET verifies that an unchanged active phase is still current.
    if (source !== "poll" || status !== payload.carrier.status || isTerminalCarrier(status) || observedAt <= payload.carrier.observedAt) return row;
  }
  return {
    ...row, updatedAt: observedAt,
    payload: {
      ...payload, carrier: { status, observedAt },
      nextCarrierCheckAt: isTerminalCarrier(status) ? null : payload.nextCarrierCheckAt ?? tsFromMs(nowMs + PHONE_CARRIER_RETRY_MS),
    },
  };
}

/** The recipient can pick up before the specialist's SIP leg has connected. */
export function phoneStatusOf(twilio: string, accepted: boolean): Exclude<PhoneStatus, "none"> {
  switch (twilio) {
    case "queued":
    case "initiated": return "dialing";
    case "ringing": return "ringing";
    case "in-progress": return accepted ? "talking" : "ringing";
    case "completed": return "ended";
    case "busy": return "busy";
    case "no-answer": return "noAnswer";
    case "failed":
    case "canceled": return "failed";
    default: return "unknown";
  }
}

export function storedPhoneStatus(row: PhoneEntry, nowMs: number): Exclude<PhoneStatus, "none"> {
  const { carrier, nextCarrierCheckAt, accepted, twilioSid } = trackedPhonePayload(row);
  if (carrier) {
    // An exhausted reconciliation keeps its last observation for ordering future callbacks.
    if (twilioSid && nextCarrierCheckAt === null && !isTerminalCarrier(carrier.status)) return "unknown";
    return phoneStatusOf(carrier.status, accepted);
  }
  if (row.state === "pending" && nowMs < msFromTs(row.at) + PHONE_SUBMISSION_WINDOW_MS) return "dialing";
  return row.state === "failed" ? "failed" : "unknown";
}

/** Projection at read time: an interrupted session needs no timer to settle a missing report. */
export function phoneCompletion(row: PhoneEntry, report: PhoneReport | null, nowMs: number): PhoneCompletion {
  const carrier = carrierOf(row);
  if (carrier?.status === "completed") {
    if (report) return "reported";
    return nowMs < msFromTs(carrier.observedAt) + PHONE_REPORT_GRACE_MS ? "awaitingReport" : "unconfirmed";
  }
  const status = storedPhoneStatus(row, nowMs);
  switch (status) {
    case "busy":
    case "noAnswer":
    case "failed":
    case "unknown": return status;
    default: return "active";
  }
}
