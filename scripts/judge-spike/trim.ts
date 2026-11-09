/**
 * Trims a take's trailing silence before it is streamed (brief 008). The owner's takes often end with seconds of
 * room tone, so the server VAD committed while the harness was still streaming the tail, and the judge went out
 * only after the tail: that wait counted as judge time. With the tail gone, the commit lands about 300 ms after
 * the last speech, as on a live microphone, and the harness sends the judge at the commit. Pure.
 *
 * Only the tail goes. Leading silence and pauses inside the line stay as they are.
 */

/** The harness's chunk: 20 ms of 24 kHz 16-bit mono, 48 bytes a millisecond. */
export const FRAME_MS = 20;
const BYTES_PER_MS = 48;
const FRAME_BYTES = FRAME_MS * BYTES_PER_MS;

/**
 * A 20 ms frame is speech when its RMS is above this, on 16-bit PCM (full scale 32,767). 400 is about -38 dBFS.
 * Both sources are 24 kHz mono 16-bit: the owner's takes from the recorder, and the synthetic audio, which is the
 * speech endpoint's raw `pcm` with a WAV header. Measured on the owner's 60 takes:
 *
 * - Room tone after the last word stays under 250 (the loudest is a 239 bump in o-17's tail; the noisiest room,
 *   o-29 and o-30, sits at 50 to 180).
 * - c-crisis-1, -2 and -5 end with a small click, 323 to 367, after 0.7 to 1.4 s of quiet. Under 400 it goes with
 *   the tail. At 300 it would stay, and so would the quiet before it, which is the wait this trim removes.
 * - Words reach 1,000 and more on every take; the quietest take (c-crisis-4) peaks near 2,000. Its last word fades
 *   through 160 to 400, and it loses the last 100 ms of that fade (180 to 340) beyond the 100 ms kept.
 *
 * Text-to-speech output should be near digital silence after the last word, far under 400 (no synthetic takes
 * existed to measure when this was set). The 100 ms kept after the last loud frame covers the usual fade of a final
 * word, and the server VAD decides where speech ends in any case. A louder click at the very end of a take (25 of
 * the owner's control takes end with one, peaking at 580 to 1,800) is above any threshold speech allows, and stays.
 */
export const SPEECH_RMS_THRESHOLD = 400;
/** Audio kept after the last frame above the threshold. */
export const KEEP_AFTER_MS = 100;

export interface TrimmedTake {
  pcm: Uint8Array;
  /** The take's length before trimming. */
  takeMs: number;
  /** Milliseconds dropped from the end. */
  trimmedMs: number;
}

/** RMS of one frame of 16-bit little-endian PCM. */
export function frameRms(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.byteLength >> 1;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += v.getInt16(i * 2, true) ** 2;
  return n === 0 ? 0 : Math.sqrt(sum / n);
}

/**
 * The take up to KEEP_AFTER_MS after its last 20 ms frame above SPEECH_RMS_THRESHOLD; null when no frame is
 * above it (the take has no speech and is refused).
 */
export function trimTail(pcm: Uint8Array): TrimmedTake | null {
  const takeMs = pcm.byteLength / BYTES_PER_MS;
  let lastLoudEnd = -1;
  for (let at = 0; at < pcm.byteLength; at += FRAME_BYTES) {
    const end = Math.min(at + FRAME_BYTES, pcm.byteLength);
    if (frameRms(pcm.subarray(at, end)) > SPEECH_RMS_THRESHOLD) lastLoudEnd = end;
  }
  if (lastLoudEnd < 0) return null;
  const keep = Math.min(pcm.byteLength, lastLoudEnd + KEEP_AFTER_MS * BYTES_PER_MS);
  return { pcm: pcm.subarray(0, keep), takeMs, trimmedMs: (pcm.byteLength - keep) / BYTES_PER_MS };
}
