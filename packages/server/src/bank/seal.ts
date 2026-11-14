/**
 * Brief 046 ruling 2: a bank's access token is sealed before it is stored, under the label `franki-bank-token`. The
 * envelope and the cipher are the generic ones in `../sealed.ts` (brief 049 ruling 17); the AAD is unchanged
 * (`["franki-bank-token", 1, uid, connectorId]`), so tokens sealed before the change open as they did.
 */
import type { SealedToken } from "@franki/core";
import { SealError, seal, unseal } from "../sealed";
import type { BankConfig } from "./config";

export { SealError };

/** `iv` is for tests only; every real write takes a fresh random IV. */
export function sealToken(keys: BankConfig["tokenKeys"], uid: string, connectorId: string, token: string, iv?: Buffer): SealedToken {
  return seal("franki-bank-token", keys, uid, connectorId, token, iv);
}

export function openToken(keys: BankConfig["tokenKeys"], uid: string, connectorId: string, sealed: SealedToken): string {
  return unseal("franki-bank-token", keys, uid, connectorId, sealed);
}
