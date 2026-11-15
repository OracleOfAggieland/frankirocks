/**
 * `/api/dev/live-test` (brief 050 part A), in the shape of `listTakes` / `saveTake`. Development only: the route
 * file is `route.dev.ts`, so a production build has no such route, and these functions also answer 404 when
 * NODE_ENV is production. There is no sign-in: the route serves only the app's own localhost origin, and it reads
 * nothing back but the run's script.
 *   GET   whether the recorder is on, the run's name, line counts, the last write and the script
 *   POST  {"events":[...]}: at most 500 events and 256 KB; each is checked, bad ones are dropped and counted
 */
import type { ClockPort } from "@franki/core";
import { liveClockPort } from "../clock/live-clock";
import { type Env, isProduction } from "../config/env";
import { sameOrigin } from "../dev/takes";
import { EVENTS_FILE, type LiveEvent, type LiveTestFiles, WORDS_FILE, checkPosted, liveTestDir, nodeFiles, writeLines } from "./sink";

export const LIVE_TEST_MAX_EVENTS = 500;
export const LIVE_TEST_MAX_BYTES = 256 * 1024;

export interface LiveTestDeps {
  env: Env;
  clock: ClockPort;
  /** The run folder's files, or null when the recorder is off. */
  files: LiveTestFiles | null;
}

export interface LiveTestResult {
  status: number;
  body: Record<string, unknown>;
}

const notFound: LiveTestResult = { status: 404, body: { error: "SCOPE" } };
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when the Origin is the request's own origin and that origin is a localhost one. */
export function localOrigin(origin: string | null, requestUrl: string): boolean {
  if (!sameOrigin(origin, requestUrl)) return false;
  try {
    const host = new URL(requestUrl).hostname;
    return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** The parsed `script.json`, or null when there is none or it is not a JSON object. */
function readScript(files: LiveTestFiles): unknown {
  const text = files.script();
  if (text === null) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** GET: the status line the runner page shows. */
export function liveTestStatus(deps: LiveTestDeps): LiveTestResult {
  if (isProduction(deps.env)) return notFound;
  const f = deps.files;
  if (f === null) return { status: 200, body: { active: false, run: null, events: 0, words: 0, lastAt: null, script: null } };
  const times = [f.lastWrite(EVENTS_FILE), f.lastWrite(WORDS_FILE)].filter((t): t is number => t !== null);
  return {
    status: 200,
    body: {
      active: true,
      run: f.run,
      events: f.lines(EVENTS_FILE),
      words: f.lines(WORDS_FILE),
      lastAt: times.length === 0 ? null : Math.round(Math.max(...times)),
      script: readScript(f),
    },
  };
}

export interface PostLiveTestInput {
  origin: string | null;
  url: string;
  /** The Content-Length header, checked before the body is read. */
  declaredBytes: number | null;
  body: () => Promise<string>;
}

/** POST: checks and appends a batch of browser or runner events. */
export async function postLiveTestEvents(deps: LiveTestDeps, input: PostLiveTestInput): Promise<LiveTestResult> {
  if (isProduction(deps.env)) return notFound;
  if (!localOrigin(input.origin, input.url)) return { status: 403, body: { error: "AUTH" } };
  if (deps.files === null) return { status: 200, body: { ok: false, active: false } };
  if (input.declaredBytes !== null && input.declaredBytes > LIVE_TEST_MAX_BYTES) return { status: 413, body: { error: "LIMIT" } };
  const text = await input.body();
  if (new TextEncoder().encode(text).byteLength > LIVE_TEST_MAX_BYTES) return { status: 413, body: { error: "LIMIT" } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 400, body: { error: "PARSE" } };
  }
  const raw = (parsed as { events?: unknown } | null)?.events;
  if (!Array.isArray(raw)) return { status: 400, body: { error: "PARSE" } };
  if (raw.length > LIVE_TEST_MAX_EVENTS) return { status: 413, body: { error: "LIMIT" } };
  const now = deps.clock.read().opsClock.now;
  const kept: LiveEvent[] = [];
  for (const e of raw) {
    const checked = checkPosted(e, now);
    if (checked !== null) kept.push(checked);
  }
  writeLines(deps.files, kept);
  return { status: 200, body: { ok: true, written: kept.length, dropped: raw.length - kept.length } };
}

/** Live deps: the run folder from `FRANKI_LIVE_TEST_DIR`, read on every request (the module keeps no state). */
export function liveTestDeps(env: Env = process.env, clock: ClockPort = liveClockPort): LiveTestDeps {
  const dir = liveTestDir(env);
  return { env, clock, files: dir === null ? null : nodeFiles(dir) };
}
