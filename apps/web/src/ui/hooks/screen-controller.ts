"use client";
// The main screen's live state (lab-ui-foundation R4.6, R9.4, R10.7, R11.4, R18.5 to R18.8, R19.2 to
// R19.4, R19.7). It runs the one frame loop over today's sources only (auth, Voice_State, mic and output
// mute, levels), and per frame: publishes the look, makes at most one coalesced announcement, schedules
// sound cues through the gate, and advances Electricity's Frame_Time. React reads it through
// useSyncExternalStore.
import { type AvatarState, type VoiceState, avatarState } from "@franki/core";
import { type AnnounceView, announcement, callStatus } from "../announce";
import { lookFor } from "../avatar/look";
import type { AvatarInput, AvatarLook } from "../avatar/types";
import type { Levels } from "../levels/level-meter";
import { type SoundTrack, initialSoundTrack, scheduleCues } from "../sound/schedule";
import type { Cue } from "../sound/score";
import { ELECTRIC_STEP_MS, FrameLoop, type FrameScheduler } from "./frame-loop";

export interface VoiceSource {
  getSnapshot(): VoiceState;
}

export interface ScreenDeps {
  scheduler: FrameScheduler;
  meter: { sample(): Levels; pause(): void; resume(): void };
  visibility: { isVisible(): boolean; subscribe(listener: (visible: boolean) => void): () => void };
  reduced: { getSnapshot(): boolean; subscribe(listener: () => void): () => void };
  /** The Visit has had a user gesture (the shared AudioContext exists). */
  gestured: () => boolean;
  soundOn: () => boolean;
  sound: { play(cue: Cue): void; setOutputMuted(muted: boolean): void } | null;
  callErrors: Readonly<Record<string, string>>;
}

export interface ScreenSnapshot {
  look: AvatarLook;
  input: AvatarInput;
  /** Advanced every 60 ms or more while the look is electric, so bolts regenerate. */
  frameTime: number;
  live: { message: string | null; seq: number };
  paused: boolean;
}


const CLOSED_INPUT: AvatarInput = {
  state: "closed", micMuted: false, outputMuted: true, inputLevel: 0, outputLevel: 0,
  event: null, eventElapsedMs: 0, firstConnecting: false, reducedMotion: true,
};

export class ScreenController {
  private voice: VoiceSource | null = null;
  private signedIn = false;
  private readonly loop: FrameLoop;
  private snapshot: ScreenSnapshot;
  private readonly listeners = new Set<() => void>();
  private prevView: AnnounceView | null = null;
  private track: SoundTrack = initialSoundTrack;
  private lastElectricAt = 0;
  private offs: (() => void)[] = [];

  constructor(private readonly deps: ScreenDeps) {
    this.snapshot = { look: lookFor(CLOSED_INPUT), input: CLOSED_INPUT, frameTime: 0, live: { message: null, seq: 0 }, paused: !deps.visibility.isVisible() };
    this.loop = new FrameLoop({
      scheduler: deps.scheduler,
      meter: deps.meter,
      visibility: deps.visibility,
      read: () => this.read(),
      publish: (look, input) => this.set({ look, input }),
      onFrame: (t, look, input) => this.frame(t, look, input),
    });
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): ScreenSnapshot => this.snapshot;

  /** Today's sources: the signed-in Voice_Client, or none while signed out. */
  setSources(signedIn: boolean, voice: VoiceSource | null): void {
    const wasSignedIn = this.signedIn;
    this.signedIn = signedIn;
    this.voice = voice;
    if (wasSignedIn && !signedIn) this.loop.input({ kind: "signOut" });
    else this.loop.input({ kind: "frame" });
  }

  start(): void {
    this.offs.push(this.deps.visibility.subscribe((visible) => this.set({ paused: !visible })));
    this.offs.push(this.deps.reduced.subscribe(() => this.loop.input({ kind: "frame" })));
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
    this.offs.forEach((off) => off());
    this.offs = [];
  }

  private voiceState(): VoiceState | null {
    return this.signedIn && this.voice !== null ? this.voice.getSnapshot() : null;
  }

  private read(): { state: AvatarState; micMuted: boolean; outputMuted: boolean; reducedMotion: boolean } {
    const v = this.voiceState();
    return {
      state: v === null ? "closed" : avatarState(v),
      micMuted: v?.micMuted ?? false,
      outputMuted: v?.outputMuted ?? true,
      reducedMotion: this.deps.reduced.getSnapshot(),
    };
  }

  private frame(t: number, look: AvatarLook, input: AvatarInput): void {
    const patch: Partial<ScreenSnapshot> = {};
    // One coalesced announcement per frame (R18.8).
    const v = this.voiceState();
    const view: AnnounceView = {
      avatar: look.label,
      call: callStatus(v ?? { phase: "CLOSED", hangingUp: false }),
      error: v?.error ? (this.deps.callErrors[v.error] ?? null) : null,
    };
    const message = announcement(this.prevView, view);
    this.prevView = view;
    if (message !== null) patch.live = { message, seq: this.snapshot.live.seq + 1 };
    // Sound cues, only through the gate; never over Franki's voice.
    this.deps.sound?.setOutputMuted(input.outputMuted);
    const step = scheduleCues(
      this.track,
      { name: look.name, at: t },
      { cardArrived: false, receiptShown: false },
      { gestured: this.deps.gestured(), soundOn: this.deps.soundOn(), outputMuted: input.outputMuted },
    );
    this.track = step.track;
    for (const cue of step.cues) this.deps.sound?.play(cue);
    // Electricity regenerates with Frame_Time.
    if (look.electric && t - this.lastElectricAt >= ELECTRIC_STEP_MS) {
      this.lastElectricAt = t;
      patch.frameTime = t;
    }
    if (Object.keys(patch).length > 0) this.set(patch);
  }

  private set(patch: Partial<ScreenSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }
}
