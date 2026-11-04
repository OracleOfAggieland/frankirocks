/**
 * Request idempotency (R10.8, R10.9, R10.11, R10.12; contracts §6 Routes "Mutationkey"; design "Idempotency").
 *
 * Each mutation keeps one ledger `request` entry with ID `H("req", uid, route, requestId)`:
 *   - `beginRequest` runs in its own transaction before any route work. A complete entry younger than 24 h replays
 *     its response (same hash) or fails 409 HASH (different hash). A pending entry whose 15 s lease is held fails
 *     429 LIMIT (same hash) or 409 HASH. Otherwise (no entry, lease lapsed, failed, or older than 24 h) it takes the
 *     lease and the route runs.
 *   - `completeRequest` writes the response inside the route's own transaction, so the response and the route's
 *     records commit together (R19.1).
 *   - `releaseRequest` marks an entry failed after an error, so a retry with the same requestId runs again;
 *     only successful responses are recorded and replayed.
 */
import {
  type ErrorCode,
  type Hash,
  type Hasher,
  type ID,
  type Ledger,
  type RouteName,
  canonicalBytes,
  idParts,
  msFromTs,
  tsFromMs,
} from "@franki/core";
import { DAY_MS, cFields } from "../records";
import { hashError, inFlightError } from "../routes/errors";
import { paths } from "../store/paths";
import type { StorePort, Tx } from "../store/port";

export const LEASE_MS = 15_000;
export const RETAIN_MS = DAY_MS;

export interface RequestKey {
  route: RouteName;
  keyHash: ID;
  requestHash: Hash;
  path: string;
}

export interface IdempotencyDeps {
  store: StorePort;
  hasher: Hasher;
}

export type Begin<R> = { kind: "new"; key: RequestKey } | { kind: "replay"; response: R };

type RequestEntry = Extract<Ledger, { kind: "request" }>;

/** SHA-256 of the canonical request body. */
export function requestHashOf(body: unknown, hasher: Hasher): Hash {
  return hasher.sha256(canonicalBytes(body));
}

export function requestKey(uid: string, route: RouteName, requestId: string, body: unknown, hasher: Hasher): RequestKey {
  const keyHash = hasher.id(idParts.request(uid, route, requestId));
  return { route, keyHash, requestHash: requestHashOf(body, hasher), path: paths.ledger(uid, keyHash) };
}

export async function beginRequest<R>(
  uid: string,
  key: RequestKey,
  opsNow: number,
  core: { epoch: number; policyRev: number },
  deps: IdempotencyDeps,
): Promise<Begin<R>> {
  return deps.store.transaction(uid, async (tx) => {
    const doc = await tx.get<RequestEntry>(key.path);
    const now = tsFromMs(opsNow);
    const pending: RequestEntry = {
      ...cFields(uid, now, core.epoch, core.policyRev),
      kind: "request",
      state: "pending",
      at: now,
      retainUntil: tsFromMs(opsNow + RETAIN_MS),
      payload: { route: key.route, keyHash: key.keyHash, requestHash: key.requestHash, response: null, error: null },
    };
    if (doc === null) {
      tx.create(key.path, pending);
      return { kind: "new", key };
    }
    const entry = doc.data;
    const sameHash = entry.payload.requestHash === key.requestHash;
    const retained = entry.retainUntil !== null && msFromTs(entry.retainUntil) > opsNow;
    if (entry.state === "complete" && retained) {
      if (!sameHash) throw hashError();
      return { kind: "replay", response: entry.payload.response as R };
    }
    if (entry.state === "pending" && msFromTs(entry.at) + LEASE_MS > opsNow) {
      throw sameHash ? inFlightError() : hashError();
    }
    tx.update(key.path, { ...pending, createdAt: entry.createdAt });
    return { kind: "new", key };
  });
}

/** Records the route's response inside the route's transaction. The entry must still hold this request's lease. */
export async function completeRequest(tx: Tx, key: RequestKey, response: object, opsNow: number): Promise<void> {
  const doc = await tx.get<RequestEntry>(key.path);
  if (doc === null || doc.data.state !== "pending" || doc.data.payload.requestHash !== key.requestHash) {
    throw hashError();
  }
  const now = tsFromMs(opsNow);
  tx.update(key.path, {
    ...doc.data,
    state: "complete",
    updatedAt: now,
    at: now,
    retainUntil: tsFromMs(opsNow + RETAIN_MS),
    payload: { ...doc.data.payload, response: response as Record<string, unknown>, error: null },
  });
}

/** Marks a pending entry failed so a retry runs again. Best effort: a failure here leaves the lease to lapse. */
export async function releaseRequest(uid: string, key: RequestKey, code: ErrorCode, opsNow: number, deps: IdempotencyDeps): Promise<void> {
  try {
    await deps.store.transaction(uid, async (tx) => {
      const doc = await tx.get<RequestEntry>(key.path);
      if (doc === null || doc.data.state !== "pending" || doc.data.payload.requestHash !== key.requestHash) return;
      tx.update(key.path, { ...doc.data, state: "failed", updatedAt: tsFromMs(opsNow), payload: { ...doc.data.payload, error: code } });
    });
  } catch {
    // The 15 s lease lapses on its own.
  }
}
