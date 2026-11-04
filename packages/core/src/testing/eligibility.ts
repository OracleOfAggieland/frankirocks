/** Test builders for `eligible` inputs: a valid EC and a Snapshot over given rows. */
import type { DocRef, EC, Row, Snapshot } from "../eligible";
import type { Evidence, Memory } from "../schema/records";
import { T0, UID, sampleCoreDocs, testId } from "./samples";

export function sampleEC(overrides: Partial<EC> = {}): EC {
  return {
    uid: UID,
    epoch: 1,
    policyRev: 1,
    generation: 1,
    stage: "project",
    execution: "serverForeground",
    operation: "say",
    purpose: "answer",
    worldNow: T0,
    opsNow: T0,
    asOf: null,
    queryTargetTime: null,
    audience: "private",
    turnId: null,
    openedTopics: [],
    authorized: [],
    explicitRequest: false,
    pendingId: null,
    ownerConfirmed: false,
    maintenanceOpId: null,
    maintenanceTask: null,
    serviceAuthorized: false,
    jobId: null,
    leaseToken: null,
    jobGeneration: null,
    ...overrides,
  };
}

export interface SnapshotRows {
  memories?: [string, Memory][];
  evidence?: [string, Evidence][];
}

export function sampleSnapshot(rows: SnapshotRows, overrides: Partial<Snapshot> = {}): Snapshot {
  const refs: DocRef[] = [];
  const list: Row[] = [];
  for (const [id, m] of rows.memories ?? []) {
    refs.push({ collection: "memories", id, parentId: null, rev: m.rev });
    list.push(m);
  }
  for (const [id, e] of rows.evidence ?? []) {
    refs.push({ collection: "evidence", id, parentId: null, rev: e.rev });
    list.push(e);
  }
  return {
    uid: UID,
    epoch: sampleCoreDocs().epoch,
    session: null,
    job: null,
    localGeneration: 1,
    refs,
    rows: list,
    blocks: [],
    coverage: { state: "complete", from: null, to: null, missingRanges: [], generation: 0 },
    complete: true,
    ...overrides,
  };
}

export const memRef = (id: string = testId("m1"), rev = 1): DocRef => ({ collection: "memories", id, parentId: null, rev });
