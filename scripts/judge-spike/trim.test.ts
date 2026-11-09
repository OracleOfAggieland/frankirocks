import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { placeholderPcm } from "./fake-realtime";
import { KEEP_AFTER_MS, SPEECH_RMS_THRESHOLD, frameRms, trimTail } from "./trim";

const MS = 48;
const silence = (ms: number) => new Uint8Array(ms * MS);
/** A square wave of ±level: its RMS is exactly `level`. */
function level(ms: number, rms: number): Uint8Array {
  const out = new Uint8Array(ms * MS);
  const v = new DataView(out.buffer);
  for (let i = 0; i < out.byteLength / 2; i++) v.setInt16(i * 2, i % 2 === 0 ? rms : -rms, true);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe("trimTail (brief 008)", () => {
  it("witness: a long silent tail is cut to 100 ms after the last loud frame", () => {
    const take = concat(placeholderPcm(1200), level(2500, 150));
    const t = trimTail(take)!;
    expect(t).toMatchObject({ takeMs: 3700, trimmedMs: 2400 });
    expect(t.pcm.byteLength).toBe((1200 + KEEP_AFTER_MS) * MS);
    expect(same(t.pcm, take.subarray(0, (1200 + KEEP_AFTER_MS) * MS))).toBe(true);
  });

  it("witness: leading silence and a pause inside the line stay", () => {
    const take = concat(silence(400), placeholderPcm(600), silence(900), placeholderPcm(600), silence(1500));
    const t = trimTail(take)!;
    const kept = 400 + 600 + 900 + 600 + KEEP_AFTER_MS;
    expect(t).toMatchObject({ takeMs: 4000, trimmedMs: 4000 - kept });
    expect(same(t.pcm, take.subarray(0, kept * MS))).toBe(true);
  });

  it("witness: an all-silent take has no speech, even at the threshold itself", () => {
    expect(trimTail(silence(2000))).toBeNull();
    expect(trimTail(level(2000, SPEECH_RMS_THRESHOLD))).toBeNull();
    expect(trimTail(new Uint8Array(0))).toBeNull();
    expect(trimTail(level(2000, SPEECH_RMS_THRESHOLD + 1))).toMatchObject({ trimmedMs: 0 });
  });

  it("keeps a take that ends in speech, or under 100 ms after it, whole", () => {
    expect(trimTail(placeholderPcm(900))).toMatchObject({ takeMs: 900, trimmedMs: 0 });
    expect(trimTail(concat(placeholderPcm(900), silence(60)))).toMatchObject({ takeMs: 960, trimmedMs: 0 });
  });

  it("measures RMS on 16-bit little-endian samples", () => {
    expect(frameRms(level(20, 1234))).toBe(1234);
    expect(frameRms(new Uint8Array(0))).toBe(0);
  });

  it("property: the kept audio is a prefix that ends at most 100 ms after the last loud frame and keeps every loud frame", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ ms: fc.integer({ min: 1, max: 30 }).map((n) => n * 20), loud: fc.boolean() }), { minLength: 1, maxLength: 12 }), (parts) => {
        const take = concat(...parts.map((p) => (p.loud ? level(p.ms, 2000) : level(p.ms, 100))));
        const t = trimTail(take);
        const lastLoud = parts.reduce((end, p, i) => (p.loud ? parts.slice(0, i + 1).reduce((n, q) => n + q.ms, 0) : end), -1);
        if (lastLoud < 0) return t === null;
        const total = parts.reduce((n, p) => n + p.ms, 0);
        const keep = Math.min(total, lastLoud + KEEP_AFTER_MS);
        return t !== null && t.pcm.byteLength === keep * MS && t.trimmedMs === total - keep && t.takeMs === total && same(t.pcm, take.subarray(0, keep * MS));
      }),
    );
  });
});
