/**
 * Is this a demo visit (brief 054, R4.8, R28)? A request with a verified token already knows: `anonymous` comes from
 * the token. Work that carries no token (the errand run endpoint, background jobs) asks the tenant's connectors: a
 * demo visit is one whose fixed connector documents hold, sealed, a simulator token. Nothing stored says "demo", so
 * this is the only other source, and it is answered here only.
 */
import type { ClockPair, Connector, Hasher } from "@franki/core";
import { BANK_ENV_VARS } from "../bank/config";
import type { Env } from "../config/env";
import { googleConnectorId } from "../google/connector";
import { type SealLabel, sealKeysFrom, unseal } from "../sealed";
import { paths } from "../store/paths";
import type { Reader } from "../store/port";
import { readSimToken } from "./token";

export interface VisitKey {
  uid: string;
  /** From the verified token, when there is one. Absent: ask the connectors. */
  anonymous?: boolean;
  env: Env;
  hasher: Pick<Hasher, "id">;
}

/** The one bank connector document a demo visit holds. Its ID is a function of the owner, so Start over reuses it. */
export const demoBankConnectorId = (hasher: Pick<Hasher, "id">, uid: string): string => hasher.id(["demo-connector", uid, "plaid"]);

/** The sealed token and its label on one connector document, or null when it holds none or is disconnected. */
function sealedOf(data: Connector): { label: SealLabel; token: NonNullable<NonNullable<Connector["bank"]>["token"]> } | null {
  if (data.state === "disconnected") return null;
  if (data.provider === "plaid") return data.bank?.token ? { label: "franki-bank-token", token: data.bank.token } : null;
  if (data.provider === "gmail" || data.provider === "calendar") return data.google?.token ? { label: "franki-google-token", token: data.google.token } : null;
  return null;
}

/**
 * Whether one connector document's token, unsealed, is a simulator token. Never throws: a missing key, a bad seal,
 * a malformed marker or a disconnected document is false. The seal's AAD is the document's own ID, as at write.
 */
export function connectorSimulated(env: Env, uid: string, doc: { id: string; data: Connector }): boolean {
  try {
    const sealed = sealedOf(doc.data);
    if (sealed === null) return false;
    const plain = unseal(sealed.label, sealKeysFrom(env, BANK_ENV_VARS.tokenKey), uid, doc.id, sealed.token);
    const t = readSimToken(plain);
    return t !== null && t !== "malformed";
  } catch {
    return false;
  }
}

/**
 * `k.anonymous` when it is defined (a verified token decided it, true or false: no connector is opened for false).
 * Otherwise true when any of the tenant's three fixed connector documents is simulated: `demoBankConnectorId`,
 * `googleConnectorId(..., "gmail")`, `googleConnectorId(..., "calendar")`. At most three point reads.
 */
export async function isDemoVisit(k: VisitKey, reader: Pick<Reader, "get">): Promise<boolean> {
  if (k.anonymous !== undefined) return k.anonymous;
  // googleConnectorId reads only `hasher.id`; the wider type is its own signature's.
  const hasher = k.hasher as Hasher;
  const ids = [demoBankConnectorId(k.hasher, k.uid), googleConnectorId(hasher, k.uid, "gmail"), googleConnectorId(hasher, k.uid, "calendar")];
  const docs = await Promise.all(ids.map((id) => reader.get<Connector>(paths.connector(k.uid, id))));
  return docs.some((d) => d !== null && connectorSimulated(k.env, k.uid, { id: d.id, data: d.data }));
}

/** The "now" a read measures from: the world clock on a demo visit, else the ops clock. */
export const readNow = (pair: ClockPair, demo: boolean): number => (demo ? pair.worldClock.now : pair.opsClock.now);
