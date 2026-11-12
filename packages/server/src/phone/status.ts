/**
 * GET /api/phone/status?sessionId=&turnId=. Read-only: where the phone call that one of the Owner's turns placed
 * stands right now, for the phone on the screen. No ledger write and no core documents.
 *
 * The answer comes from two places. The Owner's own `phoneCall` ledger row says whether the dial was claimed,
 * accepted by Twilio, declined or left unconfirmed, and whether Franki's SIP leg was accepted. Twilio's call record
 * says whether the recipient's phone is ringing, answered or done. Only the row is trusted for who owns the call:
 * the row is read at the Owner's own path, so one user can never read another's call.
 */
import { type PhoneStatus, isIdShape } from "@franki/core";
import { ConfigError } from "../config/env";
import { parseError } from "../routes/errors";
import type { RouteContext, RouteSpec } from "../routes/runtime";
import { paths } from "../store/paths";
import type { PhoneEntry } from "./outbound";
import { phoneConfig } from "./twilio";

export interface PhoneStatusRequest {
  sessionId: string;
  turnId: string;
}

/** Twilio's own status word for one call, or a throw when it can't be read. */
export type CallStatus = (config: ReturnType<typeof phoneConfig>, sid: string) => Promise<string>;

export const twilioCallStatus: CallStatus = async ({ account, token }, sid) => {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls/${sid}.json`, {
    method: "GET",
    redirect: "error",
    headers: { Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("Twilio call status unavailable");
  const data = (await response.json()) as { status?: unknown };
  if (typeof data.status !== "string") throw new Error("Missing Twilio call status");
  return data.status;
};

/**
 * Twilio's status and the row's `accepted`, as one closed word. An answered phone is `talking` only once Franki's
 * SIP leg was accepted; until then the recipient has picked up and Franki is still connecting, which shows as ringing.
 */
export function phoneStatusOf(twilio: string, accepted: boolean): PhoneStatus {
  switch (twilio) {
    case "queued":
    case "initiated":
      return "dialing";
    case "ringing":
      return "ringing";
    case "in-progress":
      return accepted ? "talking" : "ringing";
    case "completed":
      return "ended";
    case "busy":
      return "busy";
    case "no-answer":
      return "noAnswer";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return "unknown";
  }
}

/** The same ledger ID `placePhoneCall` claims for this turn (see `phoneId` in outbound.ts). */
const rowId = (ctx: RouteContext, req: PhoneStatusRequest) => ctx.deps.hasher.id(["outbound-phone", ctx.uid, req.sessionId, req.turnId]);

export async function phoneStatus(ctx: RouteContext, req: PhoneStatusRequest, callStatus: CallStatus): Promise<PhoneStatus> {
  const { uid, deps } = ctx;
  const row = await deps.store.get<PhoneEntry>(uid, paths.ledger(uid, rowId(ctx, req)));
  if (row === null || row.data.kind !== "phoneCall") return "none";
  const { state, payload } = row.data;
  if (state === "pending") return "dialing";
  if (state === "failed") return "failed";
  // `blocked`: Twilio never confirmed the request, so there is no call record to ask about.
  if (payload.twilioSid === null) return "unknown";
  try {
    return phoneStatusOf(await callStatus(phoneConfig(deps.env), payload.twilioSid), payload.accepted);
  } catch (error) {
    if (!(error instanceof ConfigError)) deps.log("phone.statusUnavailable", {});
    return "unknown";
  }
}

const QUERY_KEYS = new Set(["sessionId", "turnId"]);

export function phoneStatusRouteWith(callStatus: CallStatus): RouteSpec<PhoneStatusRequest> {
  return {
    name: "phoneStatus",
    parse: ({ query }) => {
      for (const key of query.keys()) if (!QUERY_KEYS.has(key)) throw parseError(`unknown parameter ${key}`);
      const sessionId = query.get("sessionId");
      const turnId = query.get("turnId");
      if (sessionId === null || !isIdShape(sessionId)) throw parseError("sessionId");
      if (turnId === null || !isIdShape(turnId)) throw parseError("turnId");
      return { sessionId, turnId };
    },
    run: async (ctx, req): Promise<{ status: PhoneStatus }> => ({ status: await phoneStatus(ctx, req, callStatus) }),
  };
}

export const phoneStatusRoute = phoneStatusRouteWith(twilioCallStatus);
