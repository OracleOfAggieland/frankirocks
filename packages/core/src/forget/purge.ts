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
import { EVIDENCE_CONTENT_FIELDS, type Evidence, Memory as MemorySchema, type Memory, type Turn } from "../schema/records";
import { validate } from "../schema/v";

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

/**
 * Brief 048 ruling 17: every string in a Memory's `args` emptied, keeping the row valid for its predicate. Each string
 * (or list of strings) tries null, then "", then an empty list, and keeps the first the Memory schema accepts; a value
 * none of them fits (an enum code such as `allergenCode`) is kept, and named by `keptArgs`.
 */
export function purgedArgs(m: Memory): Memory["args"] {
  let args: Record<string, unknown> = { ...m.args };
  for (const [k, v] of Object.entries(m.args)) {
    const stringy = typeof v === "string" ? v !== "" : Array.isArray(v) && v.some((x) => typeof x === "string");
    if (!stringy) continue;
    for (const empty of [null, "", []] as const) {
      const next = { ...args, [k]: empty };
      if (validate(MemorySchema, { ...m, args: next }).ok) {
        args = next;
        break;
      }
    }
  }
  return args;
}

/** The `args` keys purge had to keep because their predicate allows no empty value (for the report). */
export const keptArgs = (m: Memory): string[] => Object.entries(purgedArgs(m)).filter(([, v]) => (typeof v === "string" && v !== "") || (Array.isArray(v) && v.some((x) => typeof x === "string"))).map(([k]) => k);

/**
 * Brief 048 ruling 1: the Evidence of every assistant Turn closure withheld (blocked), with the Turn. Only a forget
 * blocks an assistant Turn's Evidence, so every blocked one is emptied (fails closed: more is removed).
 */
function speechEids(i: PurgeInput): Set<ID> {
  const status = new Map(i.evidence.map((e) => [e.id, e.evidence.status] as const));
  const out = new Set<ID>();
  for (const t of i.turns) {
    const s = t.turn.evidenceId === null ? undefined : status.get(t.turn.evidenceId);
    if (t.turn.role === "assistant" && s !== undefined && s !== "retained") out.add(t.turn.evidenceId!);
  }
  return out;
}

export function planPurge(i: PurgeInput): PurgeWrite[] {
  const out: PurgeWrite[] = [];
  const speech = speechEids(i);
  const eids = new Set([...i.blockedEids, ...speech]);
  const byId = (a: { id: ID }, b: { id: ID }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const { id, evidence } of [...i.evidence].sort(byId)) {
    if (!eids.has(id) || evidence.status === "retained") continue;
    if (evidence.status === "purged" && TEXT_CONTENT.every((f) => evidence[f] === null)) continue;
    out.push({ collection: "evidence", id, doc: purgedEvidence(evidence, i.now) });
  }
  const mids = new Set(i.memoryIds);
  for (const { id, memory } of [...i.memories].sort(byId)) {
    if (!mids.has(id) || !["blocked", "retracted", "wrong"].includes(memory.status)) continue;
    const doc: Memory = {
      ...memory,
      value: purgedValue(memory.value),
      texture: [],
      sayAs: null,
      watchTokens: [],
      watches: [],
      embedding: null,
      vectorVersion: null,
      // Brief 048 ruling 17: the owner's words in `args` and in a hypothesis's alternatives go too.
      args: purgedArgs(memory),
      hypothesis: memory.hypothesis === null ? null : { ...memory.hypothesis, alternatives: [] },
      updatedAt: i.now,
    };
    const lines = (m: Memory) => JSON.stringify([m.value, m.texture, m.sayAs, m.watchTokens, m.watches, m.embedding, m.vectorVersion, m.args, m.hypothesis?.alternatives ?? null]);
    if (lines(doc) === lines(memory)) continue;
    out.push({ collection: "memories", id, doc });
  }
  const requests = new Set(i.requestTurns.map((t) => `${t.sessionId}/${t.id}`));
  for (const t of [...i.turns].sort(byId)) {
    if (t.turn.text === null) continue;
    if (requests.has(`${t.sessionId}/${t.id}`)) out.push({ collection: "turns", id: t.id, sessionId: t.sessionId, doc: { ...t.turn, text: null, evidenceId: null, updatedAt: i.now } });
    // Brief 048 ruling 1: a withheld assistant Turn keeps its row and its Evidence link; its words go.
    else if (t.turn.role === "assistant" && t.turn.evidenceId !== null && speech.has(t.turn.evidenceId)) out.push({ collection: "turns", id: t.id, sessionId: t.sessionId, doc: { ...t.turn, text: null, updatedAt: i.now } });
  }
  return out;
}

/** The cursor's sort key: collection in `PURGE_ORDER`, then ID. */
export function purgeKey(c: { collection: string; lastId: ID | null }): [number, string] {
  return [PURGE_ORDER.indexOf(c.collection as PurgeCollection), c.lastId ?? ""];
}
