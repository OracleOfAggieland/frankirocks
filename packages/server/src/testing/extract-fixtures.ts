/**
 * Test fixtures for extraction: commit a user turn's Evidence and Extract_Job in one transaction, and build
 * ExtractV1 output Items. Used by the lineage property (task 11) and later extractor tests. Not route code:
 * `/api/turn` (task 19) writes the real Turn, Evidence and Job.
 */
import {
  type ClockPort,
  type Evidence,
  type Hasher,
  type Job,
  type Memory,
  type Turn,
  idParts,
  normalizeLF,
  rootKey,
  tsFromMs,
  turnTextSlice,
} from "@franki/core";
import { commonFields, sampleEvidence, sampleJob, sampleMemory, sampleTurn } from "@franki/core/testing";
import { evidenceId } from "../store/evidence";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";

export interface CommittedTurn {
  eid: string;
  jobId: string;
  text: string;
}

export async function commitUserTurnForTest(
  store: StorePort,
  uid: string,
  turnId: string,
  rawText: string,
  clock: ClockPort,
  hasher: Hasher,
): Promise<CommittedTurn> {
  const text = normalizeLF(rawText);
  const pair = clock.read();
  const ops = tsFromMs(pair.opsClock.now);
  const world = tsFromMs(pair.worldClock.now);
  const logicalId = hasher.id(idParts.evidenceLogical(turnId));
  const eid = evidenceId(logicalId, 1, hasher);
  const jobId = hasher.id(idParts.extractJob(eid));
  const c = commonFields({ uid, createdAt: ops, updatedAt: ops });
  const evidence: Evidence = sampleEvidence({
    ...c,
    logicalId,
    text: { kind: "inline", text },
    fieldSlices: [turnTextSlice(eid, text, "U", hasher)],
    occurredAt: world,
    assertedAt: world,
    receivedAt: ops,
    zone: pair.worldClock.zone,
    turnId,
  });
  const job: Job = sampleJob({
    ...c,
    nextAttemptAt: ops,
    sourceIds: [eid],
    inputRevs: [{ id: eid, rev: 1 }],
    payload: {
      kind: "work",
      task: "extract",
      targets: [{ type: "evidence", id: eid, rev: 1 }],
      class: "U",
      fields: [{ eid, fieldPath: "text", base: 0, end: text.length }],
      cursor: { fieldIndex: 0, offset: 0, afterId: null, leg: "exact" },
      query: null,
    },
  });
  await store.transaction(uid, async (tx) => {
    tx.create(paths.evidence(uid, eid), evidence);
    tx.create(paths.job(uid, jobId), job);
  });
  return { eid, jobId, text };
}

export interface SpanDraft {
  eid: string;
  fieldPath: "text" | "subject";
  start: number;
  end: number;
  quote: string;
}

/** A complete ExtractV1 Item for predicate `fact` (contracts §5), with the given act, target and spans. */
export function factItem(act: string, target: string, valueText: string, spans: SpanDraft[]) {
  const whenNone = { kind: "none", spoken: null, appliesTo: "occurrence", anchorHint: null };
  return {
    act,
    target,
    memoryId: null,
    kind: "fact",
    predicate: "fact",
    subject: "self",
    scope: null,
    value: { kind: "text", text: valueText },
    args: { topic: "other", label: null },
    mentions: [],
    bindings: [],
    contextIds: [],
    when: whenNone,
    endHint: null,
    changes: [],
    texture: [],
    spans,
    sens: "S0",
    gravity: 0,
    authorize: null,
    flow: "open",
    deliveryRequest: null,
  };
}

export function extractOutput(items: unknown[]) {
  return { version: "ExtractV1", items, clarifications: [], continuation: null };
}

/** Stores an active U Memory whose lineage is the whole text Slice of a committed turn's Evidence. */
export async function insertMemoryForTest(
  store: StorePort,
  uid: string,
  turn: CommittedTurn,
  hasher: Hasher,
  overrides: Partial<Memory> = {},
  label = "m1",
): Promise<string> {
  const slice = turnTextSlice(turn.eid, turn.text, "U", hasher);
  const id = hasher.id(["test-memory", label]);
  const memory = sampleMemory({
    uid,
    rootSlices: [slice],
    rootKeys: [rootKey(slice, hasher)],
    packetEids: [turn.eid],
    dependsOn: [`e:${turn.eid}`],
    supportingIds: [{ type: "evidence", id: turn.eid, rev: 1 }],
    key: hasher.id(idParts.memoryKey("self", "fact", label)),
    value: { kind: "text", text: turn.text },
    ...overrides,
  });
  await store.transaction(uid, async (tx) => tx.create(paths.memory(uid, id), memory));
  return id;
}

/** Stores a user Turn record (no Evidence or job is written). */
export async function insertTurnForTest(
  store: StorePort,
  uid: string,
  sessionId: string,
  turnId: string,
  init: Partial<Turn> & { seq: number },
): Promise<void> {
  const turn = sampleTurn({ uid, sessionId, ...init });
  await store.transaction(uid, async (tx) => tx.create(paths.turn(uid, sessionId, turnId), turn));
}
