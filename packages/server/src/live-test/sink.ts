/**
 * The live test recorder's sink (brief 050 part A). Development only: everything here is inert unless
 * `FRANKI_LIVE_TEST_DIR` names a folder and NODE_ENV is not production. A run folder holds `events.ndjson` (IDs,
 * times, counts and enum values only, the `Log` rule) and `words.ndjson` (the only place words go).
 *
 * The dev server may load this module more than once, so it keeps no state: every write is one append of whole
 * lines, and every count is read back from the files. The pure helpers (shaping and checking an event, choosing the
 * file) are separate from the file writes.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ClockPort } from "@franki/core";
import { type Env, isProduction } from "../config/env";
import type { Log } from "../routes/runtime";

export const LIVE_TEST_DIR_VAR = "FRANKI_LIVE_TEST_DIR";
export const EVENTS_FILE = "events.ndjson";
export const WORDS_FILE = "words.ndjson";
export const SCRIPT_FILE = "script.json";

export type LiveValue = string | number | boolean | string[];
export type LiveEvent = { t: number; src: string; kind: string } & Record<string, LiveValue>;
export type LiveFile = typeof EVENTS_FILE | typeof WORDS_FILE;

/** The fields every line carries; a logged field of the same name is kept as `<name>_`. */
const RESERVED = new Set(["t", "src", "kind"]);
const KIND = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;
export const KIND_MAX = 64;
export const FIELDS_MAX = 64;
export const KEY_MAX = 64;
/** A string in `events.ndjson`; IDs and enum values fit easily. */
export const EVENT_STRING_MAX = 512;
/** A string in `words.ndjson` (an utterance, a typed line, a note). */
export const WORDS_STRING_MAX = 8_000;
export const ARRAY_MAX = 64;

/** The run folder, or null when the recorder is off (rule 1). */
export function liveTestDir(env: Env): string | null {
  if (isProduction(env)) return null;
  const dir = env[LIVE_TEST_DIR_VAR];
  return dir === undefined || dir.trim() === "" ? null : dir;
}

/** Words kinds and the runner's notes go to `words.ndjson`; everything else to `events.ndjson`. */
export const isWordsKind = (kind: string): boolean => kind.startsWith("words.") || kind === "note";
export const fileFor = (kind: string): LiveFile => (isWordsKind(kind) ? WORDS_FILE : EVENTS_FILE);

/** One value as the line format allows it, or undefined when it does not fit (a nested object, NaN, a long list). */
function cleanValue(v: unknown, stringMax: number): LiveValue | undefined {
  if (typeof v === "string") return v.length > stringMax ? v.slice(0, stringMax) : v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v) && v.length <= ARRAY_MAX && v.every((x) => typeof x === "string")) return v.map((x: string) => (x.length > stringMax ? x.slice(0, stringMax) : x));
  return undefined;
}

/** A server event: the logged fields, flat, with `t`, `src: "server"` and `kind` set. Never throws. */
export function serverEvent(t: number, kind: string, fields: Readonly<Record<string, unknown>>): LiveEvent {
  const out: Record<string, LiveValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    const value = cleanValue(v, EVENT_STRING_MAX);
    if (value !== undefined) out[RESERVED.has(k) ? `${k}_` : k] = value;
  }
  return { ...out, t, src: "server", kind };
}

/**
 * A posted event (browser or runner), checked: a flat object with a dotted string `kind`, `src` of `client` or
 * `runner`, and plain values. A missing `t` takes the server's time. Null when the event is dropped.
 */
export function checkPosted(raw: unknown, now: number): LiveEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== "string" || r.kind.length > KIND_MAX || !KIND.test(r.kind)) return null;
  if (r.src !== "client" && r.src !== "runner") return null;
  if (r.t !== undefined && (typeof r.t !== "number" || !Number.isFinite(r.t))) return null;
  const entries = Object.entries(r);
  if (entries.length > FIELDS_MAX) return null;
  const stringMax = isWordsKind(r.kind) ? WORDS_STRING_MAX : EVENT_STRING_MAX;
  const out: Record<string, LiveValue> = {};
  for (const [k, v] of entries) {
    if (k.length === 0 || k.length > KEY_MAX) return null;
    const value = cleanValue(v, stringMax);
    if (value === undefined) return null;
    out[k] = value;
  }
  return { ...out, t: typeof r.t === "number" ? r.t : now, src: r.src, kind: r.kind };
}

/** The lines for each file, one JSON object per line, each ending in a newline. */
export function toLines(events: readonly LiveEvent[]): Record<LiveFile, string> {
  const lines: Record<LiveFile, string> = { [EVENTS_FILE]: "", [WORDS_FILE]: "" };
  for (const e of events) lines[fileFor(e.kind)] += `${JSON.stringify(e)}\n`;
  return lines;
}

/** Newlines in a buffer: the number of whole lines written. */
export function countLines(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) if (b === 10) n++;
  return n;
}

/** The file side of the sink; a fake in tests. */
export interface LiveTestFiles {
  /** The run's folder name. */
  run: string;
  append(file: LiveFile, text: string): void;
  lines(file: LiveFile): number;
  /** Last write time in epoch ms, or null when the file does not exist. */
  lastWrite(file: LiveFile): number | null;
  /** The text of `script.json`, or null. */
  script(): string | null;
}

export function nodeFiles(dir: string): LiveTestFiles {
  const read = (file: string): Buffer | null => {
    try {
      return readFileSync(join(dir, file));
    } catch {
      return null;
    }
  };
  return {
    run: basename(dir),
    append: (file, text) => {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, file), text);
    },
    lines: (file) => {
      const b = read(file);
      return b === null ? 0 : countLines(b);
    },
    lastWrite: (file) => {
      try {
        return statSync(join(dir, file)).mtimeMs;
      } catch {
        return null;
      }
    },
    script: () => read(SCRIPT_FILE)?.toString("utf8") ?? null,
  };
}

/** Appends the events, one append per file per batch. Returns how many lines went to each file. */
export function writeLines(files: LiveTestFiles, events: readonly LiveEvent[]): number {
  if (events.length === 0) return 0;
  const lines = toLines(events);
  for (const file of [EVENTS_FILE, WORDS_FILE] as const) if (lines[file] !== "") files.append(file, lines[file]);
  return events.length;
}

/**
 * The recorder's `Log`: appends a server event to `events.ndjson`, or null when the recorder is off. It never
 * throws into the caller and prints nothing.
 */
export function liveTestTrace(env: Env, clock: ClockPort, files?: LiveTestFiles): Log | null {
  const dir = liveTestDir(env);
  if (dir === null) return null;
  const f = files ?? nodeFiles(dir);
  return (event, fields) => {
    try {
      f.append(EVENTS_FILE, `${JSON.stringify(serverEvent(clock.read().opsClock.now, event, fields))}\n`);
    } catch {
      // A recorder that cannot write must not break the request it watches.
    }
  };
}
