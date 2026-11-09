/**
 * 16-bit PCM WAV encode and parse (brief 006 item 3). Pure: bytes in, bytes out. The judge spike's audio is
 * 24 kHz mono 16-bit little-endian PCM, the Realtime `audio/pcm` input format (contracts §6 "Realtime").
 */

export const SPIKE_SAMPLE_RATE = 24_000;
export const WAV_HEADER_BYTES = 44;

export interface Wav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** The `data` chunk: little-endian samples, interleaved when there is more than one channel. */
  pcm: Uint8Array;
}

export type WavProblem = "tooShort" | "notRiff" | "notWave" | "noFmt" | "notPcm" | "noData" | "badSize";

/** Wraps mono 16-bit little-endian PCM in a canonical 44-byte WAV header. */
export function encodeWav(pcm: Uint8Array, sampleRate: number = SPIKE_SAMPLE_RATE): Uint8Array {
  if (pcm.byteLength % 2 !== 0) throw new RangeError("16-bit PCM needs an even byte count");
  const out = new Uint8Array(WAV_HEADER_BYTES + pcm.byteLength);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  out.set(pcm, WAV_HEADER_BYTES);
  return out;
}

/** Converts samples in [-1, 1] to 16-bit little-endian PCM, clamping anything outside. */
export function floatToPcm16(samples: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, Number.isFinite(samples[i]!) ? samples[i]! : 0));
    v.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return out;
}

/** Reads a PCM WAV, walking its chunks. Returns the problem when the bytes are not one. */
export function parseWav(bytes: Uint8Array): Wav | { problem: WavProblem } {
  if (bytes.byteLength < 12) return { problem: "tooShort" };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (tag(0) !== "RIFF") return { problem: "notRiff" };
  if (tag(8) !== "WAVE") return { problem: "notWave" };
  let fmt: { channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (body + size > bytes.byteLength) return { problem: "badSize" };
    if (id === "fmt ") {
      if (size < 16) return { problem: "badSize" };
      if (v.getUint16(body, true) !== 1) return { problem: "notPcm" };
      fmt = { channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), bitsPerSample: v.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (fmt === null) return { problem: "noFmt" };
      return { ...fmt, pcm: bytes.subarray(body, body + size) };
    }
    at = body + size + (size % 2);
  }
  return { problem: fmt === null ? "noFmt" : "noData" };
}

/** True when the WAV is the spike's format: 24 kHz, mono, 16-bit. */
export function isSpikeFormat(w: Wav): boolean {
  return w.sampleRate === SPIKE_SAMPLE_RATE && w.channels === 1 && w.bitsPerSample === 16 && w.pcm.byteLength % 2 === 0;
}

/** Duration in milliseconds of mono 16-bit PCM at `sampleRate`. */
export const pcmDurationMs = (pcmBytes: number, sampleRate: number = SPIKE_SAMPLE_RATE): number => (pcmBytes / 2 / sampleRate) * 1000;
