/**
 * Sealed secrets (brief 046 ruling 2, made generic by brief 049 ruling 17). AES-256-GCM under one 32-byte key
 * (`FRANKI_BANK_TOKEN_KEY`), a fresh 12-byte IV per write, a versioned envelope (`v`) so the key can be rotated, and
 * additional authenticated data that binds a label, the owner's uid and the record's ID: a sealed value copied to
 * another record, another owner, or used under another label does not open. A sealed value never appears in a route
 * answer, a ledger row, a log line or an error.
 *
 * The label is part of the AAD, so the bank's existing sealed tokens (`franki-bank-token`) open exactly as before.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { type SealedToken, canonicalJSON } from "@franki/core";
import { type Env, ConfigError, requireEnv } from "./config/env";

/** Every label a sealed value may carry. A new use adds a label; a label is never reused for another kind. */
export const SEAL_LABELS = ["franki-bank-token", "franki-google-token", "franki-google-verifier"] as const;
export type SealLabel = (typeof SEAL_LABELS)[number];

/** The sealing key, version 1. 32 bytes. */
export type SealKeys = { 1: Buffer };

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Opening failed: wrong key, wrong label, wrong record, or a damaged envelope. Carries no detail. */
export class SealError extends Error {
  constructor() {
    super("sealed value did not open");
    this.name = "SealError";
  }
}

/** Reads the sealing key by name: 32 random bytes in base64. Anything else is a ConfigError naming the variable. */
export function sealKeysFrom(env: Env, name: string): SealKeys {
  const raw = requireEnv(name, env).trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new ConfigError(name);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new ConfigError(name);
  return { 1: key };
}

const aad = (label: SealLabel, uid: string, id: string) => Buffer.from(canonicalJSON([label, 1, uid, id]), "utf8");

/** `iv` is for tests only; every real write takes a fresh random IV. */
export function seal(label: SealLabel, keys: SealKeys, uid: string, id: string, plain: string, iv: Buffer = randomBytes(IV_BYTES)): SealedToken {
  if (iv.length !== IV_BYTES) throw new SealError();
  const cipher = createCipheriv("aes-256-gcm", keys[1], iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(label, uid, id));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, iv: iv.toString("base64url"), body: body.toString("base64url") };
}

export function unseal(label: SealLabel, keys: SealKeys, uid: string, id: string, sealed: SealedToken): string {
  try {
    if (sealed.v !== 1) throw new SealError();
    const iv = Buffer.from(sealed.iv, "base64url");
    const body = Buffer.from(sealed.body, "base64url");
    if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) throw new SealError();
    const decipher = createDecipheriv("aes-256-gcm", keys[1], iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(label, uid, id));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new SealError();
  }
}
