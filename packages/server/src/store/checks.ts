/**
 * Commit-time checks shared by the Memory_Store and the Firestore_Store (R4.6, R4.7, R4.12, R4.13, R7.10,
 * R24.3). Error details name paths and check names only, never record content (R28.1).
 */
import {
  Block,
  Connector,
  Effect,
  Overlay,
  CORE_DOCS,
  type CoreDocId,
  EVIDENCE_CONTENT_FIELDS,
  Evidence,
  type Evidence as EvidenceT,
  type Hasher,
  Job,
  Ledger,
  Memory,
  type Memory as MemoryT,
  Moment,
  type Schema,
  Session,
  Turn,
  canonicalJSON,
  evidenceFieldText,
  rootKey,
  sliceHashMatches,
  validate,
} from "@franki/core";
import { StoreError } from "./errors";
import type { ParsedPath } from "./paths";
import { MAX_RECORD_BYTES } from "./port";

export function schemaFor(p: ParsedPath): Schema<unknown> {
  switch (p.collection) {
    case "evidence":
      return Evidence;
    case "memories":
      return Memory;
    case "sessions":
      return Session;
    case "turns":
      return Turn;
    case "jobs":
      return Job;
    case "ledger":
      return Ledger;
    case "core":
      return CORE_DOCS[p.id as CoreDocId];
    // Forget rows (brief 021).
    case "blocks":
      return Block;
    case "overlays":
      return Overlay;
    case "effects":
      return Effect;
    // Moments (brief 023).
    case "moments":
      return Moment;
    // Bank connections (brief 046).
    case "connectors":
      return Connector;
  }
}

/** UTF-8 bytes of the record's JSON form. */
export function serializedBytes(record: unknown): number {
  return new TextEncoder().encode(JSON.stringify(record)).length;
}

/** Validates one record about to be written (schema, size, tenant, path consistency). */
export function checkRecord(uid: string, p: ParsedPath, record: Record<string, unknown>): void {
  const result = validate(schemaFor(p), record);
  if (!result.ok) throw new StoreError("invalidInput", `schema check failed at ${result.path}: ${result.message}`, p.path);
  if (serializedBytes(record) > MAX_RECORD_BYTES) throw new StoreError("oversize", "record is over 524,288 bytes", p.path);
  if (record.uid !== uid) throw new StoreError("tenantMismatch", "record uid is not the caller's uid", p.path);
  if (p.collection === "turns" && record.sessionId !== p.sessionId) {
    throw new StoreError("invalidInput", "turn sessionId does not match its path", p.path);
  }
}

const same = (a: unknown, b: unknown) => canonicalJSON(a) === canonicalJSON(b);

/** KC02: Evidence content and Memory value/args never change in place (R4.12, R4.13, R20.6). */
export function checkImmutable(p: ParsedPath, prior: Record<string, unknown>, next: Record<string, unknown>): void {
  if (p.collection === "evidence") {
    for (const field of EVIDENCE_CONTENT_FIELDS) {
      if (!same(prior[field], next[field])) {
        throw new StoreError("invalidInput", `Evidence is immutable: ${field} changed in place; write a new revision`, p.path);
      }
    }
    for (const field of ["logicalId", "revisionOf", "kind", "source"] as const) {
      if (!same(prior[field], next[field])) throw new StoreError("invalidInput", `Evidence is immutable: ${field} changed in place`, p.path);
    }
  }
  if (p.collection === "memories") {
    for (const field of ["value", "args", "predicate", "subjectId", "scopeId", "key"] as const) {
      if (!same(prior[field], next[field])) {
        throw new StoreError("invalidInput", `Memory ${field} is immutable; write a new Memory`, p.path);
      }
    }
  }
}

/**
 * W-LINEAGE write check (R24.3; KC03). Returns the failed checks; empty means the Memory may be written.
 * `getEvidence` reads Evidence under the same Tenant_Root, including Evidence created in the same transaction.
 */
export async function lineageFailures(
  m: MemoryT,
  getEvidence: (eid: string) => Promise<EvidenceT | null>,
  hasher: Hasher,
): Promise<string[]> {
  const failures: string[] = [];
  if (m.rootSlices.length === 0) failures.push("emptyRootSlices");
  if (m.dependsOn.length === 0) failures.push("emptyDependsOn");
  if (m.rootKeys.length !== m.rootSlices.length) failures.push("rootKeysLength");
  const deps = new Set(m.dependsOn);
  for (let i = 0; i < m.rootSlices.length; i++) {
    const slice = m.rootSlices[i]!;
    if (m.rootKeys[i] !== undefined && m.rootKeys[i] !== rootKey(slice, hasher)) failures.push(`rootKeyMismatch[${i}]`);
    if (!deps.has(`e:${slice.eid}`)) failures.push(`missingDependsOn[${i}]`);
    const evidence = await getEvidence(slice.eid);
    if (evidence === null) {
      failures.push(`missingEvidence[${i}]`);
      continue;
    }
    const text = evidenceFieldText(evidence, slice.fieldPath);
    if (text === null || !sliceHashMatches(slice, text, hasher)) failures.push(`sliceHashMismatch[${i}]`);
  }
  return failures;
}

export function throwOnLineage(path: string, failures: string[]): void {
  if (failures.length > 0) throw new StoreError("invalidInput", `W-LINEAGE failed: ${failures.join(", ")}`, path, failures);
}
