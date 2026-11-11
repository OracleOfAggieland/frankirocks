// The read-only audio source for a renderer that acts on the sound itself (brief 013, design note
// docs/briefs/013-design.md §2.4 D1). Pure types and constants. The Level_Meter implements it with a second
// analyser per stream; the specimens page implements it with a simulated voice. A renderer reads it only
// while the look's gate for that stream is open, so it never decides anything.

export type AudioReader = "mic" | "voice";

export interface AvatarAudioSource {
  /**
   * Fills `time` (AUDIO_FFT_SIZE samples, -1..1) and `db` (AUDIO_FFT_SIZE / 2 bins, in dB) with the newest analysis
   * of one stream and returns its sample rate in Hz, or returns 0 when there is nothing to read (no stream, no
   * audio graph yet, paused or failed). `dt` is the reader's seconds since its last read: a simulator advances by it,
   * the Level_Meter ignores it.
   */
  read(which: AudioReader, dt: number, time: Float32Array<ArrayBuffer>, db: Float32Array<ArrayBuffer>): number;
}

/** The analyser settings the acting was tuned on (prototype line 474). */
export const AUDIO_FFT_SIZE = 1024;
export const AUDIO_SMOOTHING = 0;
export const AUDIO_MIN_DB = -140;
export const AUDIO_MAX_DB = 0;

/** A source with nothing to read. */
export const NO_AUDIO: AvatarAudioSource = Object.freeze({ read: () => 0 });
