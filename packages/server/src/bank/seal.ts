/**
 * Brief 046 ruling 2: a bank's access token is sealed before it is stored. AES-256-GCM under FRANKI_BANK_TOKEN_KEY,
 * a fresh 12-byte IV per write, a versioned envelope (`v`) so the key can be rotated, and the owner's uid and the
 * connector's ID bound in as additional authenticated data: a sealed token copied to another connector or another
 * user's document does not open. The token never appears in a route answer, a ledger row, a log line or an error.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { type SealedToken, canonicalJSON } from "@franki/core";
import type { BankConfig } from "./config";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Opening failed: wrong key, wrong connector, or a damaged envelope. Carries no detail. */
export class SealError extends Error {
  constructor() {
    super("bank token did not open");
    this.name = "SealError";
  }
}

const aad = (uid: string, connectorId: string) => Buffer.from(canonicalJSON(["franki-bank-token", 1, uid, connectorId]), "utf8");

/** `iv` is for tests only; every real write takes a fresh random IV. */
export function sealToken(keys: BankConfig["tokenKeys"], uid: string, connectorId: string, token: string, iv: Buffer = randomBytes(IV_BYTES)): SealedToken {
  if (iv.length !== IV_BYTES) throw new SealError();
  const cipher = createCipheriv("aes-256-gcm", keys[1], iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(uid, connectorId));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, iv: iv.toString("base64url"), body: body.toString("base64url") };
}

export function openToken(keys: BankConfig["tokenKeys"], uid: string, connectorId: string, sealed: SealedToken): string {
  try {
    if (sealed.v !== 1) throw new SealError();
    const iv = Buffer.from(sealed.iv, "base64url");
    const body = Buffer.from(sealed.body, "base64url");
    if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) throw new SealError();
    const decipher = createDecipheriv("aes-256-gcm", keys[1], iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(uid, connectorId));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new SealError();
  }
}
