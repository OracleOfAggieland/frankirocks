import { parseWav } from "@franki/core";
import { describe, expect, it } from "vitest";
import { loadLines } from "./lines";
import { SPEECH_URL, TTS_VOICES, type SynthDeps, manifestText, synthPlan, synthesize } from "./synth";

const lines = loadLines();
const KEY = "fake-key-for-tests";

function fakeDeps(status = (_i: number) => 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const files = new Map<string, Uint8Array>();
  const logs: string[] = [];
  const deps: SynthDeps = {
    fetch: async (url, init) => {
      const i = calls.length;
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: status(i) === 200, status: status(i), arrayBuffer: async () => new Uint8Array([1, 0, 2, 0, 3]).buffer };
    },
    writeFile: (path, bytes) => files.set(path, bytes),
    mkdir: () => {},
    log: (l) => logs.push(l),
  };
  return { deps, calls, files, logs };
}

describe("synthetic audio", () => {
  it("spreads the lines across at least four voices", () => {
    const plan = synthPlan(lines, (id) => `/a/${id}.wav`);
    expect(TTS_VOICES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(plan.map((r) => r.voice)).size).toBe(TTS_VOICES.length);
    expect(plan.map((r) => r.id)).toEqual(lines.map((l) => l.id));
  });

  it("asks for raw PCM with the configured model and writes 24 kHz mono WAV named by line ID", async () => {
    const { deps, calls, files, logs } = fakeDeps();
    const two = lines.slice(0, 2);
    const r = await synthesize(two, synthPlan(two, (id) => `/a/${id}.wav`), { model: "tts-from-config", apiKey: KEY, outDir: "/a" }, deps);
    expect(calls.map((c) => c.url)).toEqual([SPEECH_URL, SPEECH_URL]);
    expect(calls[0]!.body).toEqual({ model: "tts-from-config", voice: "alloy", input: two[0]!.text, response_format: "pcm" });
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(r.written.map((w) => w.id)).toEqual(two.map((l) => l.id));
    const wav = parseWav(files.get(`/a/${two[0]!.id}.wav`)!);
    expect(wav).toMatchObject({ sampleRate: 24_000, channels: 1, bitsPerSample: 16 });
    expect("pcm" in wav && wav.pcm.byteLength).toBe(4);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("records a failed line and goes on", async () => {
    const { deps, files } = fakeDeps((i) => (i === 0 ? 429 : 200));
    const two = lines.slice(0, 2);
    const r = await synthesize(two, synthPlan(two, (id) => id), { model: "m", apiKey: KEY, outDir: "/a" }, deps);
    expect(r.failed).toEqual([{ id: two[0]!.id, status: 429 }]);
    expect([...files.keys()]).toEqual([two[1]!.id]);
  });

  it("writes a voice manifest", () => {
    expect(JSON.parse(manifestText([{ id: "o-01", voice: "ash", path: "x" }], "m"))).toEqual({ model: "m", voices: { "o-01": "ash" } });
  });
});
