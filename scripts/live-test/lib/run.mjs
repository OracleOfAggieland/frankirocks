// Brief 050 part C: reading a run folder. Every file is optional except that a folder with none of meta.json,
// events.ndjson and words.ndjson is not a run. Bad lines are counted and skipped, never fatal.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export class InputError extends Error {}

/** Parses NDJSON text. A line must be an object with a numeric `t` and a string `kind`. */
export function parseNdjson(text) {
  const rows = [];
  let bad = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      bad += 1;
      continue;
    }
    if (row === null || typeof row !== "object" || Array.isArray(row) || typeof row.kind !== "string" || typeof row.t !== "number" || !Number.isFinite(row.t)) {
      bad += 1;
      continue;
    }
    rows.push(row);
  }
  rows.sort((a, b) => a.t - b.t);
  return { rows, bad };
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new InputError(`${what} is not valid JSON`);
  }
}

/** The start time from meta.json, whatever the launcher named it: epoch ms or an ISO string. */
export function metaStart(meta) {
  if (!meta || typeof meta !== "object") return null;
  for (const key of ["startedAt", "startedAtMs", "start", "startTime", "startMs", "t", "at"]) {
    const v = meta[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return null;
}

/** Records in one export file: `{docs:[…]}` or a bare array. Each doc keeps `id`, `data` and the times. */
export function exportDocs(json) {
  const docs = Array.isArray(json) ? json : Array.isArray(json?.docs) ? json.docs : [];
  return docs.filter((d) => d && typeof d === "object").map((d) => ({ ...d, data: d.data && typeof d.data === "object" ? d.data : d }));
}

/** Script steps with `id` and `title`; others are dropped. */
export function scriptSteps(script) {
  const steps = Array.isArray(script?.steps) ? script.steps : [];
  return steps.filter((s) => s && typeof s.id === "string" && s.id !== "").map((s) => ({ id: s.id, title: typeof s.title === "string" ? s.title : "", group: typeof s.group === "string" ? s.group : "" }));
}

export function loadRun(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new InputError(`not a folder: ${dir}`);
  const has = (name) => existsSync(join(dir, name));
  if (!has("meta.json") && !has("events.ndjson") && !has("words.ndjson")) {
    throw new InputError(`not a run folder (no meta.json, events.ndjson or words.ndjson): ${dir}`);
  }
  const meta = has("meta.json") ? readJson(join(dir, "meta.json"), "meta.json") : null;
  const script = has("script.json") ? readJson(join(dir, "script.json"), "script.json") : null;
  const events = has("events.ndjson") ? parseNdjson(readFileSync(join(dir, "events.ndjson"), "utf8")) : { rows: [], bad: 0 };
  const words = has("words.ndjson") ? parseNdjson(readFileSync(join(dir, "words.ndjson"), "utf8")) : { rows: [], bad: 0 };
  const firestore = {};
  const fsDir = join(dir, "firestore");
  if (existsSync(fsDir) && statSync(fsDir).isDirectory()) {
    for (const name of readdirSync(fsDir)) {
      if (!name.endsWith(".json") || name === "index.json") continue;
      try {
        firestore[name.slice(0, -5)] = exportDocs(JSON.parse(readFileSync(join(fsDir, name), "utf8")));
      } catch {
        firestore[name.slice(0, -5)] = [];
      }
    }
  }
  return {
    name: dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop(),
    meta,
    script,
    events: events.rows,
    words: words.rows,
    badLines: events.bad + words.bad,
    firestore: Object.keys(firestore).length > 0 ? firestore : null,
  };
}
