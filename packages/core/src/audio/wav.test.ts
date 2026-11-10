import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { encodeWav, floatToPcm16, isSpikeFormat, parseWav, pcmDurationMs } from "./wav";

describe("wav", () => {
  it("round-trips any even-length PCM (property)", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 400 }).filter((a) => a.length % 2 === 0), (pcm) => {
        const w = parseWav(encodeWav(pcm));
        expect("problem" in w).toBe(false);
        if ("problem" in w) return;
        expect(isSpikeFormat(w)).toBe(true);
        expect([...w.pcm]).toEqual([...pcm]);
      }),
    );
  });

  it("writes the canonical header", () => {
    const wav = encodeWav(new Uint8Array(4));
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(24_000);
    expect(wav.byteLength).toBe(48);
  });

  it("skips unknown chunks and names what is wrong", () => {
    const base = encodeWav(new Uint8Array(2));
    const list = new Uint8Array([..."LIST"].map((c) => c.charCodeAt(0)).concat([2, 0, 0, 0, 9, 9]));
    const withList = new Uint8Array([...base.subarray(0, 36), ...list, ...base.subarray(36)]);
    expect("problem" in parseWav(withList)).toBe(false);
    expect(parseWav(new Uint8Array(4))).toEqual({ problem: "tooShort" });
    expect(parseWav(new TextEncoder().encode("hello world, not a wav"))).toEqual({ problem: "notRiff" });
    const notPcm = encodeWav(new Uint8Array(2));
    notPcm[20] = 3;
    expect(parseWav(notPcm)).toEqual({ problem: "notPcm" });
    expect(parseWav(base.subarray(0, 40))).toEqual({ problem: "noData" });
  });

  it("rejects other rates and channel counts as the spike format", () => {
    const w = parseWav(encodeWav(new Uint8Array(4), 48_000));
    expect("problem" in w ? null : isSpikeFormat(w)).toBe(false);
  });

  it("clamps floats to 16-bit", () => {
    const v = new DataView(floatToPcm16([0, 1, -1, 2, Number.NaN]).buffer);
    expect([0, 2, 4, 6, 8].map((i) => v.getInt16(i, true))).toEqual([0, 32767, -32768, 32767, 0]);
  });

  it("gives durations", () => expect(pcmDurationMs(48_000)).toBe(1000));
});
