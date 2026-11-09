/**
 * Hashing for IDs and content (contracts §1 ID and Hash; design "IDs", "Hashes").
 * The HMAC key is FRANKI_ID_HMAC_KEY. It is read by name only and never logged.
 */
import { createHash, createHmac } from "node:crypto";
import { type Hasher, canonicalJSON } from "@franki/core";
import { type Env, idHmacKey } from "./config/env";

/** Lowercase hex SHA-256. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** base64url(HMAC-SHA256(key, canonicalJSON(parts))), 43 characters. */
export function hmacId(key: string, parts: unknown): string {
  return createHmac("sha256", key).update(canonicalJSON(parts), "utf8").digest("base64url");
}

/** A Hasher bound to one key. */
export function createHasher(key: string): Hasher {
  if (key.length === 0) throw new TypeError("createHasher needs a non-empty key");
  return {
    id: (parts) => hmacId(key, parts),
    sha256: (bytes) => sha256Hex(bytes),
  };
}

/** A Hasher keyed from FRANKI_ID_HMAC_KEY. Throws ConfigError naming the variable when it is unset. */
export function hasherFromEnv(env: Env = process.env): Hasher {
  return createHasher(idHmacKey(env));
}
