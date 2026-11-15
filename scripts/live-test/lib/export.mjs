// Brief 050 part C: the export's logic behind a read-only seam, so tests run it on an in-memory fake.
//
// The seam is one function: `list(collectionPath)` resolves to `[{ id, data, createTime, updateTime }]` (times in
// epoch ms or null). Nothing here can write to Firestore; the live seam in export.mjs only calls `get()`.
//
// Paths follow packages/server/src/store/paths.ts: every record is under `users/{uid}/…`, with the raw Firebase
// Auth uid as the segment (no hashing of the path), and turns under `users/{uid}/sessions/{sid}/turns`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Written whole. `sessions` also brings each session's turns, written as `turns`. */
export const WHOLE = ["sessions", "ledger", "jobs", "memories", "core", "errands", "errandMarks", "moments", "blocks", "overlays", "effects"];
/** Evidence is kept from this long before the run's start. */
export const EVIDENCE_LEAD_MS = 5 * 60_000;
/** The same rule as `UID_PATTERN` in paths.ts. */
const UID_PATTERN = /^[^/]{1,128}$/;
/** A connector field with one of these in its name holds a token or a sealed value. */
const SEALED_KEY = /token|verifier|secret|sealed|cipher|cursor|password|apikey/i;
export const SEALED = "[sealed]";

export function isUid(v) {
  return typeof v === "string" && UID_PATTERN.test(v) && v.trim() === v;
}

/** The distinct signed-in user IDs from the browser's `user` events, in first-seen order. */
export function userIds(events) {
  const seen = [];
  for (const e of events) if (e.kind === "user" && isUid(e.uid) && !seen.includes(e.uid)) seen.push(e.uid);
  return seen;
}

/** A sealed value as stored: `{v, iv, body}` (SealedToken in packages/core/src/schema/records.ts). */
const isSealedShape = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && "iv" in v && "body" in v;

/**
 * A copy with every sealed value replaced by "[sealed]", anywhere. With `keys`, also every non-null field whose name
 * says token, verifier, secret, sealed, cipher or cursor (connectors).
 */
export function redact(value, keys = false) {
  if (Array.isArray(value)) return value.map((v) => redact(v, keys));
  if (value === null || typeof value !== "object") return value;
  if (isSealedShape(value)) return SEALED;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = keys && v !== null && SEALED_KEY.test(k) ? SEALED : redact(v, keys);
  return out;
}

const isoMs = (v) => {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/** When an evidence row was created or last changed: the document's update time, else its `receivedAt`. */
export function changedAt(doc) {
  return doc.updateTime ?? doc.createTime ?? isoMs(doc.data?.receivedAt);
}

const shape = (uid, collection, docs, extra = {}) => ({
  collection,
  uid,
  count: docs.length,
  ...extra,
  docs: docs.map((d) => ({ id: d.id, ...(d.sessionId ? { sessionId: d.sessionId } : {}), createTime: d.createTime ?? null, updateTime: d.updateTime ?? null, data: d.data })),
});

/**
 * Reads one user's records through `list` and returns the files to write, keyed by collection name. Counts only in
 * `counts`. `since` is the run's start in epoch ms (null keeps every evidence row).
 */
export async function collect({ list, uid, since }) {
  if (!isUid(uid)) throw new Error("not a user ID");
  const root = `users/${uid}`;
  const files = {};
  const counts = {};
  for (const name of WHOLE) {
    const docs = (await list(`${root}/${name}`)).map((d) => ({ ...d, data: redact(d.data) }));
    files[name] = shape(uid, name, docs);
    counts[name] = docs.length;
    if (name === "sessions") {
      const turns = [];
      for (const s of docs) {
        for (const t of await list(`${root}/sessions/${s.id}/turns`)) turns.push({ ...t, sessionId: s.id, data: redact(t.data) });
      }
      files.turns = shape(uid, "turns", turns);
      counts.turns = turns.length;
    }
  }
  const cutoff = since === null ? null : since - EVIDENCE_LEAD_MS;
  const evidence = await list(`${root}/evidence`);
  const kept = evidence.filter((d) => cutoff === null || (changedAt(d) ?? Infinity) >= cutoff).map((d) => ({ ...d, data: redact(d.data) }));
  files.evidence = shape(uid, "evidence", kept, { since: cutoff === null ? null : new Date(cutoff).toISOString(), older: evidence.length - kept.length });
  counts.evidence = kept.length;
  counts.evidenceOlder = evidence.length - kept.length;
  const connectors = (await list(`${root}/connectors`)).map((d) => ({ ...d, data: redact(d.data, true) }));
  files.connectors = shape(uid, "connectors", connectors);
  counts.connectors = connectors.length;
  return { files, counts };
}

export function writeFiles(runDir, uid, { files, counts }, exportedAt) {
  const dir = join(runDir, "firestore");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, `${name}.json`), `${JSON.stringify({ ...body, exportedAt }, null, 2)}\n`);
  writeFileSync(join(dir, "index.json"), `${JSON.stringify({ uid, exportedAt, counts }, null, 2)}\n`);
}

/** Reads `KEY=value` from a dotenv file's text, for one key only. */
export function dotenvValue(text, key) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(`${key}=`)) continue;
    let v = line.slice(key.length + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v === "" ? null : v;
  }
  return null;
}
