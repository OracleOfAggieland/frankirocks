/** Brief 046: a route rig with the fake bank and the bank's settings. */
import type { Connector } from "@franki/core";
import { testId } from "@franki/core/testing";
import { bankConnectRoute, bankSyncRoute } from "../bank/routes";
import { connectorIdFor } from "../bank/connector";
import { paths } from "../store/paths";
import { BANK_ENV, FakeBank } from "./fake-bank";
import { TEST_ENV, callRoute, testRig } from "./fakes";

export const OWNER = "owner-1";

export function bankRig() {
  const rig = testRig({ ...TEST_ENV, ...BANK_ENV });
  const bank = new FakeBank();
  rig.deps.bank = bank;
  return { rig, bank };
}

export const bankRequestId = (n: number | string) => testId(`bank-request-${n}`);

/**
 * Connects through the route and, unless told not to, makes the first pull the way the screen does: its first
 * POST /api/bank/sync (connect schedules none; part C follow-up 2). The sync's own failure is not the connect's.
 */
export async function connectVia(rig: ReturnType<typeof testRig>, n: number | string = 1, opts: { pull?: boolean } = {}) {
  const res = await callRoute(rig, bankConnectRoute, { requestId: bankRequestId(n), publicToken: `public-sandbox-${n}` });
  if (opts.pull !== false && res.status === 200) await callRoute(rig, bankSyncRoute, { connectorId: res.body.bank.connectorId });
  return res;
}

export const connectorIdOf = (rig: ReturnType<typeof testRig>, n: number | string = 1) => connectorIdFor(rig.deps.hasher, OWNER, bankRequestId(n));

export async function storedConnector(rig: ReturnType<typeof testRig>, id: string): Promise<Connector | null> {
  return ((await rig.store.get(OWNER, paths.connector(OWNER, id)))?.data as Connector | undefined) ?? null;
}
