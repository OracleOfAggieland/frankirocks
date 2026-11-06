// The Level_Meter (lab-ui-foundation R10.7, R11.1, R11.2, R11.4, R11.5, R11.7). Web Audio analysers
// over the mic and remote streams. Each source connects to its analyser and nothing else, so the
// meter never plays audio. It records, stores and sends nothing. Web Audio errors read as 0.
import { levelFrom } from "./level-math";

export interface Levels {
  input: number;
  output: number;
}

export interface LevelMeter {
  /** Disconnects the old nodes first (R11.5). */
  setStreams(s: { mic: MediaStream | null; output: MediaStream | null }): void;
  /** One analyser read per stream per call; 0 and 0 when a stream or the context is missing (R11.4). */
  sample(): Levels;
  /** While the document is hidden (R10.7). */
  pause(): void;
  resume(): void;
  dispose(): void;
}

export const FFT_SIZE = 512;

interface Tap {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  buffer: Uint8Array<ArrayBuffer> | null;
  level: number;
  failed: boolean;
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
  tap.source = null;
  tap.analyser = null;
}

export function createLevelMeter(getContext: () => AudioContext | null): LevelMeter {
  let mic: Tap | null = null;
  let output: Tap | null = null;
  let paused = false;

  const tap = (stream: MediaStream | null): Tap | null =>
    stream === null ? null : { stream, source: null, analyser: null, buffer: null, level: 0, failed: false };

  function read(t: Tap | null): number {
    if (t === null || t.failed) return 0;
    try {
      if (t.analyser === null) {
        const ctx = getContext();
        if (ctx === null) return 0;
        const source = ctx.createMediaStreamSource(t.stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        source.connect(analyser);
        t.source = source;
        t.analyser = analyser;
        t.buffer = new Uint8Array(analyser.fftSize);
      }
      t.analyser.getByteTimeDomainData(t.buffer!);
      t.level = levelFrom(t.buffer!, t.level);
      return t.level;
    } catch {
      t.failed = true;
      disconnect(t);
      return 0;
    }
  }

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
  };
}
