/**
 * Purge, pure (spec §8 step 8; contracts §8 step 8; brief 047 ruling 9). It only ever removes. In the floor it
 * deletes the text of the Evidence this op blocked (there are no chunks, vectors or lex rows on this branch), the
 * text of the dead request turns, and the values and lines of the Memories this op blocked or withdrew. It keeps
 * blocks, overlays, content-free holds, every rule in `core/rules`, the receipt's counts, and every row ID with its
 * state (blocked Evidence becomes `purged`; nothing else changes state). Retracted effects carry no prose on this
 * branch, so purge writes none.
 *
 * Writes are ordered by `PURGE_ORDER` and then ID, so the executor's cursor (the last write committed) only advances.
 */
import type { ID, TS } from "../schema/primitives";
import { EVIDENCE_CONTENT_FIELDS, type Evidence, type Memory, type Turn } from "../schema/records";

export const PURGE_ORDER = ["evidence", "memories", "turns"] as const;
export type PurgeCollection = (typeof PURGE_ORDER)[number];

export type PurgeWrite =
  | { collection: "evidence"; id: ID; doc: Evidence }
  | { collection: "memories"; id: ID; doc: Memory }
  | { collection: "turns"; id: ID; sessionId: ID; doc: Turn };

export interface PurgeInput {
  now: TS;
  /** Evidence this op blocked (install's and the request's). */
  blockedEids: readonly ID[];
  /** Memories this op blocked or withdrew (closure's derivatives, minus code survivors). */
  memoryIds: readonly ID[];
  requestTurns: readonly { sessionId: ID; id: ID }[];
  evidence: readonly { id: ID; evidence: Evidence }[];
  memories: readonly { id: ID; memory: Memory }[];
  turns: readonly { sessionId: ID; id: ID; turn: Turn }[];
}

/** Content fields that hold text and may be null (contracts §1 Evidence); `fieldSlices` keep only hashes. */
const TEXT_CONTENT = EVIDENCE_CONTENT_FIELDS.filter((f) => f !== "fieldSlices" && f !== "recipient" && f !== "observation");

/** A value with its prose removed: text empties, numbers and money go to zero; codes, booleans and IDs are not prose. */
export function purgedValue(v: Memory["value"]): Memory["value"] {
  if (v.kind === "text") return { kind: "text", text: "" };
  if (v.kind === "number") return { ...v, num: 0 };
  if (v.kind === "money") return { ...v, amountMinor: 0 };
  return v;
}

export function purgedEvidence(e: Evidence, now: TS): Evidence {
  const cleared = Object.fromEntries(TEXT_CONTENT.map((f) => [f, null]));
  return { ...e, ...cleared, recipient: [], observation: { kind: "none" }, status: "purged", purgedAt: e.purgedAt ?? now, updatedAt: now } as Evidence;
}

export function planPurge(i: PurgeInput): PurgeWrite[] {
  const out: PurgeWrite[] = [];
  const eids = new Set(i.blockedEids);
  const byId = (a: { id: ID }, b: { id: ID }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const { id, evidence } of [...i.evidence].sort(byId)) {
    if (!eids.has(id) || evidence.status === "retained") continue;
    if (evidence.status === "purged" && TEXT_CONTENT.every((f) => evidence[f] === null)) continue;
    out.push({ collection: "evidence", id, doc: purgedEvidence(evidence, i.now) });
  }
  const mids = new Set(i.memoryIds);
  for (const { id, memory } of [...i.memories].sort(byId)) {
    if (!mids.has(id) || !["blocked", "retracted", "wrong"].includes(memory.status)) continue;
    const doc: Memory = { ...memory, value: purgedValue(memory.value), texture: [], sayAs: null, watchTokens: [], watches: [], embedding: null, vectorVersion: null, updatedAt: i.now };
    const lines = (m: Memory) => JSON.stringify([m.value, m.texture, m.sayAs, m.watchTokens, m.watches, m.embedding, m.vectorVersion]);
    if (lines(doc) === lines(memory)) continue;
    out.push({ collection: "memories", id, doc });
  }
  const requests = new Set(i.requestTurns.map((t) => `${t.sessionId}/${t.id}`));
  for (const t of [...i.turns].sort(byId)) {
    if (!requests.has(`${t.sessionId}/${t.id}`) || t.turn.text === null) continue;
    out.push({ collection: "turns", id: t.id, sessionId: t.sessionId, doc: { ...t.turn, text: null, evidenceId: null, updatedAt: i.now } });
  }
  return out;
}

/** The cursor's sort key: collection in `PURGE_ORDER`, then ID. */
export function purgeKey(c: { collection: string; lastId: ID | null }): [number, string] {
  return [PURGE_ORDER.indexOf(c.collection as PurgeCollection), c.lastId ?? ""];
}
