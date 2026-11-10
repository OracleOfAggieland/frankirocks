/**
 * The owner's recorded takes for the judge spike (brief 006 item 3). Development only: the route that calls this
 * exists only under `next dev` (`route.dev.ts`), and these functions also refuse to run when NODE_ENV is
 * production. A take is saved as `<lineId>.wav` in scripts/judge-spike/audio/owner, overwriting a retake.
 *
 * Guard: the line ID must be one in scripts/judge-spike/lines.json, the body a 24 kHz mono 16-bit WAV under
 * 2 MB, and the request same-origin (a page on another site cannot write files through the dev server).
 * There is no Firebase sign-in: the route serves only localhost development, and writes only fixed file names.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isSpikeFormat, parseWav } from "@franki/core";
import { type Env, isProduction } from "../config/env";

export const TAKE_MAX_BYTES = 2 * 1024 * 1024;
const LINE_ID = /^(c-[a-z]+-[1-9]|o-[0-9]{2})$/;

export interface TakeLine {
  id: string;
  text: string;
}

export interface TakesDeps {
  env: Env;
  /** The probe lines, in file order. */
  lines(): TakeLine[];
  has(lineId: string): boolean;
  write(lineId: string, wav: Uint8Array): void;
}

export interface TakesResult {
  status: number;
  body: Record<string, unknown>;
}

const notFound: TakesResult = { status: 404, body: { error: "SCOPE" } };

/** True when the request's Origin header is the request URL's own origin. */
export function sameOrigin(origin: string | null, requestUrl: string): boolean {
  if (origin === null) return false;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

/** GET: every line with whether a take exists, and the count. */
export function listTakes(deps: TakesDeps): TakesResult {
  if (isProduction(deps.env)) return notFound;
  const lines = deps.lines().map((l) => ({ ...l, recorded: deps.has(l.id) }));
  return { status: 200, body: { lines, recorded: lines.filter((l) => l.recorded).length, total: lines.length } };
}

export interface SaveTakeInput {
  lineId: string | null;
  origin: string | null;
  url: string;
  /** The Content-Length header, checked before the body is read. */
  declaredBytes: number | null;
  body: () => Promise<Uint8Array>;
}

/** PUT: validates and saves one take. */
export async function saveTake(deps: TakesDeps, input: SaveTakeInput): Promise<TakesResult> {
  if (isProduction(deps.env)) return notFound;
  if (!sameOrigin(input.origin, input.url)) return { status: 403, body: { error: "AUTH" } };
  const known = new Set(deps.lines().map((l) => l.id));
  if (input.lineId === null || !LINE_ID.test(input.lineId) || !known.has(input.lineId)) return { status: 400, body: { error: "SCOPE" } };
  if (input.declaredBytes !== null && input.declaredBytes >= TAKE_MAX_BYTES) return { status: 413, body: { error: "LIMIT" } };
  const bytes = await input.body();
  if (bytes.byteLength >= TAKE_MAX_BYTES) return { status: 413, body: { error: "LIMIT" } };
  const wav = parseWav(bytes);
  if ("problem" in wav || !isSpikeFormat(wav) || wav.pcm.byteLength === 0) return { status: 400, body: { error: "PARSE" } };
  deps.write(input.lineId, bytes);
  return { status: 200, body: { lineId: input.lineId, bytes: bytes.byteLength } };
}

/** The repo folder holding scripts/judge-spike/lines.json, searched upward from `start`. */
export function findSpikeDir(start: string): string | null {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    const candidate = join(dir, "scripts", "judge-spike");
    if (existsSync(join(candidate, "lines.json"))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

/** Live deps on the local file system, rooted at the spike folder found from the working directory. */
export function liveTakesDeps(env: Env = process.env, start: string = process.cwd()): TakesDeps {
  const spikeDir = findSpikeDir(start);
  if (spikeDir === null) throw new Error("scripts/judge-spike/lines.json not found above the working directory");
  const ownerDir = join(spikeDir, "audio", "owner");
  const fileOf = (id: string) => join(ownerDir, `${id}.wav`);
  return {
    env,
    lines: () => {
      const doc = JSON.parse(readFileSync(join(spikeDir, "lines.json"), "utf8")) as { lines?: unknown };
      if (!Array.isArray(doc.lines)) return [];
      return doc.lines
        .filter((l): l is TakeLine => typeof l === "object" && l !== null && typeof l.id === "string" && typeof l.text === "string")
        .map((l) => ({ id: l.id, text: l.text }));
    },
    has: (id) => LINE_ID.test(id) && existsSync(fileOf(id)),
    write: (id, wav) => {
      mkdirSync(ownerDir, { recursive: true });
      writeFileSync(fileOf(id), wav);
    },
  };
}
