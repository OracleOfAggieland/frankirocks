// The Level_Meter (lab-ui-foundation R10.7, R11.1, R11.2, R11.4, R11.5, R11.7). Web Audio analysers
// over the mic and remote streams. Each source connects to its analysers and nothing else, so the
// meter never plays audio. It records, stores and sends nothing. Web Audio errors read as 0.
//
// Brief 013 WP16 (design note docs/briefs/013-design.md §2.4 D-1): each tap also carries a second analyser,
// configured as the three.js prototype's audio tap (prototype lines 470-487), and the meter exposes it as
// `audio`, the AvatarAudioSource the three.js ghost's probes read. The second analyser hangs off the same
// source node, is created on its first read, and leaves the first analyser, `sample()` and `rawInput()`
// exactly as they were.
import {
  AUDIO_FFT_SIZE,
  AUDIO_MAX_DB,
  AUDIO_MIN_DB,
  AUDIO_SMOOTHING,
  type AudioReader,
  type AvatarAudioSource,
} from "./audio-source";
import { levelFrom, rawLevel } from "./level-math";

export interface Levels {
  input: number;
  output: number;
}

export interface LevelMeter {
  /** Disconnects the old nodes first (R11.5). */
  setStreams(s: { mic: MediaStream | null; output: MediaStream | null }): void;
  /** One analyser read per stream per call; 0 and 0 when a stream or the context is missing (R11.4). */
  sample(): Levels;
  /**
   * The mic's unsmoothed `rawLevel`, for the Voice_Client's last-loud-frame clock (voice-control R18.5). It reads
   * the same analyser and leaves the smoothed level alone; 0 while paused or with no mic.
   */
  rawInput(): number;
  /** While the document is hidden (R10.7). */
  pause(): void;
  resume(): void;
  dispose(): void;
}

export const FFT_SIZE = 512;

/**
 * The life of a tap's second analyser. `unbuilt` until its first read; `live` once it is connected to the tap's
 * source; `failed` after a Web Audio error on it (it reads 0 from then on, and the first analyser is untouched);
 * `closed` once the tap is disconnected. `failed` and `closed` are absorbing.
 */
export type AudioTap =
  | { phase: "unbuilt" }
  | { phase: "live"; analyser: AnalyserNode }
  | { phase: "failed" }
  | { phase: "closed" };

export type AudioTapEvent =
  | { kind: "built"; analyser: AnalyserNode }
  | { kind: "error" }
  | { kind: "disconnected" };

export const UNBUILT_AUDIO_TAP: AudioTap = Object.freeze({ phase: "unbuilt" });

/** The one transition function of `AudioTap`. Total: a pair not listed keeps the state. */
export function audioTapStep(s: AudioTap, e: AudioTapEvent): AudioTap {
  if (s.phase === "failed" || s.phase === "closed") return s;
  switch (e.kind) {
    case "built":
      return s.phase === "unbuilt" ? { phase: "live", analyser: e.analyser } : s;
    case "error":
      return { phase: "failed" };
    case "disconnected":
      return { phase: "closed" };
  }
}

interface Tap {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  buffer: Uint8Array<ArrayBuffer> | null;
  level: number;
  failed: boolean;
  /** The second analyser, for `audio` (WP16). */
  audio: AudioTap;
}

function disconnect(tap: Tap | null): void {
  if (tap === null) return;
  try {
    tap.source?.disconnect();
  } catch {
    // already disconnected
  }
  try {
    tap.analyser?.disconnect();
  } catch {
    // already disconnected
  }
  if (tap.audio.phase === "live") {
    try {
      tap.audio.analyser.disconnect();
    } catch {
      // already disconnected
    }
  }
  tap.source = null;
  tap.analyser = null;
  tap.audio = audioTapStep(tap.audio, { kind: "disconnected" });
}

export function createLevelMeter(getContext: () => AudioContext | null): LevelMeter & { audio: AvatarAudioSource } {
  let mic: Tap | null = null;
  let output: Tap | null = null;
  let paused = false;

  const tap = (stream: MediaStream | null): Tap | null =>
    stream === null
      ? null
      : { stream, source: null, analyser: null, buffer: null, level: 0, failed: false, audio: UNBUILT_AUDIO_TAP };

  /** Creates the tap's source and first analyser once; false when there is no context. Web Audio errors throw. */
  function build(t: Tap): boolean {
    if (t.analyser === null) {
      const ctx = getContext();
      if (ctx === null) return false;
      const source = ctx.createMediaStreamSource(t.stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(analyser);
      t.source = source;
      t.analyser = analyser;
      t.buffer = new Uint8Array(analyser.fftSize);
    }
    return true;
  }

  /** Reads the analyser into the tap's buffer; false when there is nothing to read. */
  function fill(t: Tap | null): t is Tap {
    if (t === null || t.failed) return false;
    try {
      if (!build(t)) return false;
      t.analyser!.getByteTimeDomainData(t.buffer!);
      return true;
    } catch {
      t.failed = true;
      disconnect(t);
      return false;
    }
  }

  function read(t: Tap | null): number {
    if (!fill(t)) return 0;
    t.level = levelFrom(t.buffer!, t.level);
    return t.level;
  }

  /**
   * The avatar's read of one stream (AvatarAudioSource): the prototype's `audio.fill` (prototype 483-487) on the
   * tap's second analyser. 0 while paused, with no stream, unless the context is running, or after an error.
   * `dt` is not used: the analyser always holds the newest window.
   */
  function readAudio(
    which: AudioReader,
    time: Float32Array<ArrayBuffer>,
    db: Float32Array<ArrayBuffer>,
  ): number {
    if (paused) return 0;
    const t = which === "mic" ? mic : output;
    if (t === null || t.failed) return 0;
    if (t.audio.phase === "failed" || t.audio.phase === "closed") return 0;
    const ctx = getContext();
    if (ctx === null || ctx.state !== "running") return 0;
    // The source node is the first analyser's, built by the same code `sample()` uses, so a stream is tapped once.
    // An error here is the tap's own error, handled exactly as `fill` handles it.
    try {
      if (!build(t)) return 0;
    } catch {
      t.failed = true;
      disconnect(t);
      return 0;
    }
    try {
      if (t.audio.phase === "unbuilt") {
        // Prototype 473-474, with the settings the acting was tuned on. The prototype's gain-0 sink to the
        // destination (475-476) is not ported: the meter connects its analysers to nothing (R11.1).
        const an = ctx.createAnalyser();
        an.fftSize = AUDIO_FFT_SIZE; an.smoothingTimeConstant = AUDIO_SMOOTHING; an.minDecibels = AUDIO_MIN_DB; an.maxDecibels = AUDIO_MAX_DB;
        t.source!.connect(an);
        t.audio = audioTapStep(t.audio, { kind: "built", analyser: an });
      }
      if (t.audio.phase !== "live") return 0;
      // Prototype 484-486, in its order.
      const sr = ctx.sampleRate;
      t.audio.analyser.getFloatTimeDomainData(time);
      t.audio.analyser.getFloatFrequencyData(db);
      return sr;
    } catch {
      if (t.audio.phase === "live") {
        try {
          t.audio.analyser.disconnect();
        } catch {
          // already disconnected
        }
      }
      t.audio = audioTapStep(t.audio, { kind: "error" });
      return 0;
    }
  }

  const audio: AvatarAudioSource = {
    read(which, _dt, time, db) {
      return readAudio(which, time, db);
    },
  };

  return {
    setStreams(s) {
      if (s.mic !== (mic?.stream ?? null)) {
        disconnect(mic);
        mic = tap(s.mic);
      }
      if (s.output !== (output?.stream ?? null)) {
        disconnect(output);
        output = tap(s.output);
      }
    },
    sample() {
      if (paused) return { input: 0, output: 0 };
      return { input: read(mic), output: read(output) };
    },
    rawInput() {
      if (paused || !fill(mic)) return 0;
      return rawLevel(mic.buffer!);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    dispose() {
      disconnect(mic);
      disconnect(output);
      mic = null;
      output = null;
    },
    audio,
  };
}
