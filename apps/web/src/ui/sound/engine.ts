// The sound engine (lab-ui-foundation R19.1, R19.4, R19.5; design "Sound engine"). Plays cue scores on
// the shared AudioContext through one master GainNode whose value never goes above 0.25. Loads no
// audio file: tones are oscillators and crackles are seeded noise. Times are AudioContext.currentTime.
import { mulberry32 } from "../electricity";
import { type Cue, MAX_CUE_GAIN, type Note, scoreFor } from "./score";

export const MASTER_GAIN = MAX_CUE_GAIN;
/** The fade when Franki's voice becomes audible, in seconds (within R19.4's 50 ms). */
export const FADE_S = 0.04;

export interface SoundEngine {
  play(cue: Cue): void;
  /** Tell the engine whether Franki's voice is muted; unmuting fades every playing cue to silence. */
  setOutputMuted(muted: boolean): void;
  dispose(): void;
}

interface Playing {
  sources: AudioScheduledSourceNode[];
}

export function createSoundEngine(getContext: () => AudioContext | null): SoundEngine {
  let master: GainNode | null = null;
  let masterCtx: AudioContext | null = null;
  let outputMuted = true;
  let playing: Playing[] = [];
  let noise: AudioBuffer | null = null;

  function ensureMaster(ctx: AudioContext): GainNode {
    if (master === null || masterCtx !== ctx) {
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
      masterCtx = ctx;
    }
    return master;
  }

  function noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (noise === null) {
      const length = Math.floor(ctx.sampleRate * 0.6);
      noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noise.getChannelData(0);
      const rand = mulberry32(0x5eed);
      for (let i = 0; i < length; i++) data[i] = rand() * 2 - 1;
    }
    return noise;
  }

  function voice(ctx: AudioContext, out: GainNode, note: Note, t0: number): AudioScheduledSourceNode {
    const start = t0 + note.startMs / 1000;
    const end = start + note.durMs / 1000;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(Math.min(note.peakGain, MAX_CUE_GAIN), start + Math.min(0.01, (end - start) / 2));
    env.gain.linearRampToValueAtTime(0, end);
    env.connect(out);
    let source: AudioScheduledSourceNode;
    if (note.type === "noise") {
      const buffer = ctx.createBufferSource();
      buffer.buffer = noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = note.freq;
      buffer.connect(filter);
      filter.connect(env);
      source = buffer;
    } else {
      const osc = ctx.createOscillator();
      osc.type = note.type;
      osc.frequency.value = note.freq;
      osc.connect(env);
      source = osc;
    }
    source.start(start);
    source.stop(end);
    return source;
  }

  return {
    play(cue) {
      const ctx = getContext();
      if (ctx === null || !outputMuted) return;
      try {
        const out = ensureMaster(ctx);
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setValueAtTime(MASTER_GAIN, ctx.currentTime);
        const t0 = ctx.currentTime;
        const entry: Playing = { sources: scoreFor(cue).map((n) => voice(ctx, out, n, t0)) };
        playing.push(entry);
        const last = entry.sources[entry.sources.length - 1];
        if (last) last.onended = () => (playing = playing.filter((p) => p !== entry));
      } catch {
        // no sound is better than a broken call
      }
    },
    setOutputMuted(muted) {
      const was = outputMuted;
      outputMuted = muted;
      if (!was || muted || master === null || masterCtx === null) return;
      try {
        const t = masterCtx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(0, t + FADE_S);
        for (const p of playing) {
          for (const s of p.sources) {
            try {
              s.stop(t + FADE_S);
            } catch {
              // already stopped
            }
          }
        }
        playing = [];
      } catch {
        // ignore
      }
    },
    dispose() {
      try {
        master?.disconnect();
      } catch {
        // ignore
      }
      master = null;
      masterCtx = null;
      playing = [];
    },
  };
}
