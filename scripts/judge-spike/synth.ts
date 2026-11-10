/**
 * Synthetic probe audio (brief 006 item 3): each line through OpenAI text-to-speech, spread across six voices,
 * written as 24 kHz mono 16-bit WAV named by line ID. It asks for `pcm`, which the speech endpoint returns as raw
 * 24 kHz 16-bit little-endian mono samples, and adds the WAV header itself so the format is known.
 *
 * The model ID comes from Model_Config (`FRANKI_TTS_MODEL`). Network goes through the injected `fetch`, and the
 * CLI only passes the real one with `--live`. The key is sent in a header and never logged.
 */
import { encodeWav } from "@franki/core";
import type { ProbeLine } from "./lines";

export const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
/** At least four voices (brief 006 item 3), assigned round-robin in line order. */
export const TTS_VOICES = ["alloy", "ash", "coral", "echo", "sage", "shimmer"] as const;

export interface SynthDeps {
  fetch: (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{
    ok: boolean;
    status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  writeFile: (path: string, bytes: Uint8Array) => void;
  mkdir: (path: string) => void;
  log: (line: string) => void;
}

export interface SynthPlanRow {
  id: string;
  voice: string;
  path: string;
}

/** Which voice says which line, and where it goes. Pure. */
export function synthPlan(lines: readonly ProbeLine[], pathOf: (id: string) => string): SynthPlanRow[] {
  return lines.map((l, i) => ({ id: l.id, voice: TTS_VOICES[i % TTS_VOICES.length]!, path: pathOf(l.id) }));
}

export interface SynthResult {
  written: SynthPlanRow[];
  failed: { id: string; status: number }[];
}

/** Synthesizes every planned line, one request at a time. A failed line is recorded and skipped. */
export async function synthesize(
  lines: readonly ProbeLine[],
  plan: readonly SynthPlanRow[],
  opts: { model: string; apiKey: string; outDir: string },
  deps: SynthDeps,
): Promise<SynthResult> {
  const text = new Map(lines.map((l) => [l.id, l.text]));
  deps.mkdir(opts.outDir);
  const result: SynthResult = { written: [], failed: [] };
  for (const row of plan) {
    const res = await deps.fetch(SPEECH_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model, voice: row.voice, input: text.get(row.id), response_format: "pcm" }),
    });
    if (!res.ok) {
      result.failed.push({ id: row.id, status: res.status });
      deps.log(`${row.id}: failed with HTTP ${res.status}`);
      continue;
    }
    const pcm = new Uint8Array(await res.arrayBuffer());
    deps.writeFile(row.path, encodeWav(pcm.byteLength % 2 === 0 ? pcm : pcm.subarray(0, pcm.byteLength - 1)));
    result.written.push(row);
    deps.log(`${row.id}: ${row.voice}`);
  }
  return result;
}

/** The voice manifest written beside the audio, so the harness can record each line's voice. */
export const manifestText = (rows: readonly SynthPlanRow[], model: string): string =>
  JSON.stringify({ model, voices: Object.fromEntries(rows.map((r) => [r.id, r.voice])) }, null, 2) + "\n";
