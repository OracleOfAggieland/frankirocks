/**
 * Evidence revisions (R4.9; KC02; contracts §1 "Evidence ID=H(logicalId,version)").
 * Content never changes in place: a change appends a new Evidence with the same `logicalId`, a new eid derived from
 * the next version, and `revisionOf` set to the prior eid. The prior record is left exactly as it was.
 */
import { type Evidence, type Hasher, idParts } from "@franki/core";
import { StoreError } from "./errors";
import { paths } from "./paths";
import type { Tx } from "./port";

/** Max revisions searched when recovering a version number from an eid. */
const MAX_VERSION = 1024;

export const evidenceId = (logicalId: string, version: number, hasher: Hasher) => hasher.id(idParts.evidence(logicalId, version));

/** Finds the version number behind an eid (1-based). */
export function versionOf(eid: string, logicalId: string, hasher: Hasher): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) if (evidenceId(logicalId, v, hasher) === eid) return v;
  return null;
}

/**
 * Appends a revision inside a transaction. `next` is the full new record (content changed, C fields set by the
 * caller); `logicalId` and `revisionOf` are set here. Returns the new eid.
 */
export async function appendEvidenceRevision(
  tx: Tx,
  uid: string,
  priorEid: string,
  next: Evidence,
  hasher: Hasher,
): Promise<string> {
  const prior = await tx.get<Evidence>(paths.evidence(uid, priorEid));
  if (prior === null) throw new StoreError("invalidInput", "prior Evidence does not exist", paths.evidence(uid, priorEid));
  const logicalId = prior.data.logicalId;
  const version = versionOf(priorEid, logicalId, hasher);
  if (version === null) throw new StoreError("invalidInput", "prior eid is not H(logicalId, version)", prior.path);
  const eid = evidenceId(logicalId, version + 1, hasher);
  tx.create(paths.evidence(uid, eid), { ...next, logicalId, revisionOf: priorEid, rev: 1 });
  return eid;
}
