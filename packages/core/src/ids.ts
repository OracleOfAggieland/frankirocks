/**
 * ID and hash inputs (contracts §1 ID; design "IDs"). Core builds canonical inputs only; hashing is injected,
 * because Node's crypto is not available in the browser bundle.
 *
 *   ID   = base64url(HMAC-SHA256(FRANKI_ID_HMAC_KEY, canonicalJSON(parts)))   43 characters
 *   Hash = lowercase hex SHA-256 of bytes                                     64 characters
 */
import type { Slice } from "./schema/primitives";
import { utf8 } from "./text";

/** The injected hashing functions. The server backs them with node:crypto (packages/server/src/crypto.ts). */
export interface Hasher {
  /** HMAC ID of canonicalJSON(parts). */
  id(parts: unknown): string;
  /** SHA-256 hex of the bytes. */
  sha256(bytes: Uint8Array): string;
}

/** Canonical JSON: object keys sorted by UTF-16 code units, no whitespace, finite numbers only. */
export function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJSON: non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
      const keys = Object.keys(value).sort();
      const parts: string[] = [];
      for (const k of keys) {
        const v = (value as Record<string, unknown>)[k];
        if (v === undefined) throw new TypeError(`canonicalJSON: undefined at key ${k}`);
        parts.push(`${JSON.stringify(k)}:${canonicalJSON(v)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJSON: unsupported ${typeof value}`);
  }
}

export const canonicalBytes = (value: unknown): Uint8Array => utf8(canonicalJSON(value));

/** True when `id` has the shape of an ID (43 base64url characters). Also used for browser-made turn/request IDs. */
export const isIdShape = (id: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(id);

/** Parts for each server-derived ID (design "IDs" table). */
export const idParts = {
  session: (uid: string, requestId: string) => ["session", uid, requestId],
  assistantTurn: (sessionId: string, responseId: string) => ["aturn", sessionId, responseId],
  evidenceLogical: (turnId: string) => ["ev", turnId],
  /** contracts §1 "Evidence ID=H(logicalId,version)". */
  evidence: (logicalId: string, version: number) => [logicalId, version],
  memory: (jobId: string, itemIndex: number) => ["mem", jobId, itemIndex],
  extractJob: (eid: string) => ["job", "extract", eid],
  hangupJob: (sessionId: string) => ["job", "hangup", sessionId],
  permit: (stamp: unknown, kind: string, approvedPayloadHash: string) => ["permit", stamp, kind, approvedPayloadHash],
  request: (uid: string, route: string, requestId: string) => ["req", uid, route, requestId],
  /** KC05: key = H(resolved subject, predicate, scope). `scope` is a scope ID, or the literal "global". */
  memoryKey: (subjectId: string, predicate: string, scope: string) => ["key", subjectId, predicate, scope],
} as const;

/** Root key of a Slice: H(canonicalJSON(slice)) (design "Hashes"). */
export function rootKey(slice: Slice, hasher: Hasher): string {
  return hasher.id(slice);
}
