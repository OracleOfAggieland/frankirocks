/**
 * Record paths under the Tenant_Root `users/{uid}` (R7.6, R7.10). Paths are full strings so the Store_Port can
 * reject any path outside the caller's tenant.
 */
import { CORE_DOC_IDS, type CoreDocId, isIdShape } from "@franki/core";
import { StoreError } from "./errors";

export const TOP_COLLECTIONS = ["evidence", "memories", "sessions", "jobs", "ledger", "core", "blocks", "overlays", "effects", "moments"] as const;
export type TopCollection = (typeof TOP_COLLECTIONS)[number];
export type Collection = TopCollection | "turns";

export interface ParsedPath {
  path: string;
  uid: string;
  collection: Collection;
  id: string;
  /** Set for turns only. */
  sessionId: string | null;
}

export const tenantRoot = (uid: string) => `users/${uid}`;

export const paths = {
  evidence: (uid: string, eid: string) => `users/${uid}/evidence/${eid}`,
  memory: (uid: string, mid: string) => `users/${uid}/memories/${mid}`,
  session: (uid: string, sessionId: string) => `users/${uid}/sessions/${sessionId}`,
  turn: (uid: string, sessionId: string, turnId: string) => `users/${uid}/sessions/${sessionId}/turns/${turnId}`,
  job: (uid: string, jobId: string) => `users/${uid}/jobs/${jobId}`,
  ledger: (uid: string, entryId: string) => `users/${uid}/ledger/${entryId}`,
  core: (uid: string, doc: CoreDocId) => `users/${uid}/core/${doc}`,
  collection: (uid: string, collection: TopCollection) => `users/${uid}/${collection}`,
  turns: (uid: string, sessionId: string) => `users/${uid}/sessions/${sessionId}/turns`,
  // Forget rows (brief 021).
  block: (uid: string, blockId: string) => `users/${uid}/blocks/${blockId}`,
  overlay: (uid: string, overlayId: string) => `users/${uid}/overlays/${overlayId}`,
  effect: (uid: string, effectId: string) => `users/${uid}/effects/${effectId}`,
  // Moments (brief 023).
  moment: (uid: string, momentId: string) => `users/${uid}/moments/${momentId}`,
};

const UID_PATTERN = /^[^/]{1,128}$/;

function checkUid(uid: string): void {
  if (!UID_PATTERN.test(uid)) throw new StoreError("invalidInput", `invalid uid`, "uid");
}

function checkDocId(collection: Collection, id: string, path: string): void {
  if (collection === "core") {
    if (!(CORE_DOC_IDS as readonly string[]).includes(id)) throw new StoreError("invalidInput", `unknown core document ${id}`, path);
  } else if (!isIdShape(id)) {
    throw new StoreError("invalidInput", `document id is not an ID`, path);
  }
}

/** Parses a document path and checks it is under `users/{uid}` (R7.10). */
export function parseDocPath(uid: string, path: string): ParsedPath {
  checkUid(uid);
  const parts = path.split("/");
  if (parts[0] !== "users" || parts.length < 4) throw new StoreError("invalidInput", "not a tenant record path", path);
  if (parts[1] !== uid) throw new StoreError("tenantMismatch", "path is outside the caller's Tenant_Root", path);
  if (parts.length === 4 && (TOP_COLLECTIONS as readonly string[]).includes(parts[2]!)) {
    const collection = parts[2] as TopCollection;
    checkDocId(collection, parts[3]!, path);
    return { path, uid, collection, id: parts[3]!, sessionId: null };
  }
  if (parts.length === 6 && parts[2] === "sessions" && parts[4] === "turns") {
    checkDocId("sessions", parts[3]!, path);
    checkDocId("turns", parts[5]!, path);
    return { path, uid, collection: "turns", id: parts[5]!, sessionId: parts[3]! };
  }
  throw new StoreError("invalidInput", "unsupported record path", path);
}

export interface ParsedCollection {
  path: string;
  uid: string;
  collection: Collection;
  sessionId: string | null;
}

/** Parses a collection path and checks it is under `users/{uid}`. */
export function parseCollectionPath(uid: string, path: string): ParsedCollection {
  checkUid(uid);
  const parts = path.split("/");
  if (parts[0] !== "users" || parts.length < 3) throw new StoreError("invalidInput", "not a tenant collection path", path);
  if (parts[1] !== uid) throw new StoreError("tenantMismatch", "path is outside the caller's Tenant_Root", path);
  if (parts.length === 3 && (TOP_COLLECTIONS as readonly string[]).includes(parts[2]!)) {
    return { path, uid, collection: parts[2] as TopCollection, sessionId: null };
  }
  if (parts.length === 5 && parts[2] === "sessions" && parts[4] === "turns") {
    checkDocId("sessions", parts[3]!, path);
    return { path, uid, collection: "turns", sessionId: parts[3]! };
  }
  throw new StoreError("invalidInput", "unsupported collection path", path);
}

/** The collection path that holds a document. */
export function parentOf(p: ParsedPath): string {
  return p.path.slice(0, p.path.lastIndexOf("/"));
}
