/** The screen reads the owner's stored carrier status for the requested turn. */
import { type PhoneStatus, isIdShape } from "@franki/core";
import { parseError } from "../routes/errors";
import type { RouteContext, RouteSpec } from "../routes/runtime";
import { paths } from "../store/paths";
import { dialIdForTurn, storedPhoneStatus } from "./lifecycle";
import { schedulePhoneCheck } from "./reconcile";
import type { PhoneEntry } from "./outbound";

export interface PhoneStatusRequest {
  sessionId: string;
  turnId: string;
}

export async function phoneStatus(ctx: RouteContext, req: PhoneStatusRequest): Promise<PhoneStatus> {
  const { uid, deps } = ctx;
  const id = dialIdForTurn(deps.hasher, uid, req.sessionId, req.turnId);
  const row = await deps.store.get<PhoneEntry>(uid, paths.ledger(uid, id));
  if (row === null || row.data.kind !== "phoneCall") return "none";
  schedulePhoneCheck(ctx, row.id, row.data);
  return storedPhoneStatus(row.data, deps.clock.read().opsClock.now);
}

const QUERY_KEYS = new Set(["sessionId", "turnId"]);

export const phoneStatusRoute: RouteSpec<PhoneStatusRequest> = {
  name: "phoneStatus",
  parse: ({ query }) => {
    for (const key of query.keys()) if (!QUERY_KEYS.has(key)) throw parseError(`unknown parameter ${key}`);
    const sessionId = query.get("sessionId");
    const turnId = query.get("turnId");
    if (sessionId === null || !isIdShape(sessionId)) throw parseError("sessionId");
    if (turnId === null || !isIdShape(turnId)) throw parseError("turnId");
    return { sessionId, turnId };
  },
  run: async (ctx, req): Promise<{ status: PhoneStatus }> => ({ status: await phoneStatus(ctx, req) }),
};
