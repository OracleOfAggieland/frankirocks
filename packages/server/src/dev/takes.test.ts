import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWav } from "@franki/core";
import { afterEach, describe, expect, it } from "vitest";
import { TAKE_MAX_BYTES, type TakesDeps, findSpikeDir, listTakes, liveTakesDeps, sameOrigin, saveTake } from "./takes";

const URL_ = "http://localhost:3000/api/dev/takes?line=o-01";
const ORIGIN = "http://localhost:3000";

function fakeDeps(env: Record<string, string> = {}) {
  const files = new Map<string, Uint8Array>();
  const deps: TakesDeps = {
    env,
    lines: () => [
      { id: "o-01", text: "Hey Franki, how's it going?" },
      { id: "c-forget-1", text: "Forget what I said." },
    ],
    has: (id) => files.has(id),
    write: (id, wav) => files.set(id, wav),
  };
  return { deps, files };
}

const wav = encodeWav(new Uint8Array(480));
const put = (over: Partial<Parameters<typeof saveTake>[1]> = {}) => ({
  lineId: "o-01",
  origin: ORIGIN,
  url: URL_,
  declaredBytes: wav.byteLength,
  body: async () => wav,
  ...over,
});

describe("dev takes", () => {
  it("saves a known line's WAV and overwrites a retake", async () => {
    const { deps, files } = fakeDeps();
    expect(await saveTake(deps, put())).toEqual({ status: 200, body: { lineId: "o-01", bytes: wav.byteLength } });
    const retake = encodeWav(new Uint8Array(96));
    await saveTake(deps, put({ body: async () => retake, declaredBytes: retake.byteLength }));
    expect(files.get("o-01")).toBe(retake);
    expect(listTakes(deps).body).toMatchObject({ recorded: 1, total: 2 });
  });

  it("accepts only known line IDs", async () => {
    const { deps, files } = fakeDeps();
    for (const lineId of [null, "o-99", "../o-01", "o-01.wav", "c-forget-1/../../x"]) {
      expect((await saveTake(deps, put({ lineId }))).status, String(lineId)).toBe(400);
    }
    expect(files.size).toBe(0);
  });

  it("refuses bodies of 2 MB or more, before and after reading", async () => {
    const { deps } = fakeDeps();
    let read = false;
    const r = await saveTake(deps, put({ declaredBytes: TAKE_MAX_BYTES, body: async () => ((read = true), wav) }));
    expect(r.status).toBe(413);
    expect(read).toBe(false);
    const big = encodeWav(new Uint8Array(TAKE_MAX_BYTES));
    expect((await saveTake(deps, put({ declaredBytes: null, body: async () => big }))).status).toBe(413);
  });

  it("refuses anything but a 24 kHz mono 16-bit WAV with samples", async () => {
    const { deps } = fakeDeps();
    for (const body of [new TextEncoder().encode("not a wav at all"), encodeWav(new Uint8Array(4), 48_000), encodeWav(new Uint8Array(0))]) {
      expect((await saveTake(deps, put({ body: async () => body }))).status).toBe(400);
    }
  });

  it("refuses cross-origin and missing-origin writes", async () => {
    const { deps } = fakeDeps();
    expect((await saveTake(deps, put({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await saveTake(deps, put({ origin: null }))).status).toBe(403);
    expect(sameOrigin("http://localhost:3000", URL_)).toBe(true);
    expect(sameOrigin("not a url", URL_)).toBe(false);
  });

  it("is absent in production", async () => {
    const { deps, files } = fakeDeps({ NODE_ENV: "production" });
    expect(listTakes(deps).status).toBe(404);
    expect((await saveTake(deps, put())).status).toBe(404);
    expect(files.size).toBe(0);
  });
});

describe("live takes deps", () => {
  let tmp: string | null = null;
  afterEach(() => {
    if (tmp !== null) rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it("finds the spike folder from apps/web and reads the real line set", () => {
    const dir = findSpikeDir(join(process.cwd(), "apps", "web"));
    expect(dir).not.toBeNull();
    const deps = liveTakesDeps({}, join(process.cwd(), "apps", "web"));
    expect(deps.lines()).toHaveLength(60);
  });

  it("writes into audio/owner", async () => {
    tmp = mkdtempSync(join(tmpdir(), "takes-"));
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(tmp, "scripts", "judge-spike"), { recursive: true });
    writeFileSync(join(tmp, "scripts", "judge-spike", "lines.json"), JSON.stringify({ lines: [{ id: "o-01", text: "Hi" }] }));
    const deps = liveTakesDeps({}, tmp);
    deps.write("o-01", wav);
    expect(deps.has("o-01")).toBe(true);
    expect(readFileSync(join(tmp, "scripts", "judge-spike", "audio", "owner", "o-01.wav"))).toEqual(Buffer.from(wav));
  });
});
