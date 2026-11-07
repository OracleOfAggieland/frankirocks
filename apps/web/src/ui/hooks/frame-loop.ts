"use client";
// The one requestAnimationFrame loop for the screen (lab-ui-foundation R10.6, R10.7, R11.1; design
// "Reduced motion and visibility"). Each frame it samples the Level_Meter, feeds the Frame_Time to the
// Event_Controller, calls the Look_Mapper, and publishes only when a discrete field changes or `drive`
// moves by at least 1/32. Frame_Time is the only time it uses. While the page is hidden it schedules
// no frame and pauses the meter.
import type { AvatarState } from "@franki/core";
import { type EventInput, type EventState, currentEvent, initialEventState, reduceEvents } from "../avatar/events";
import { lookFor } from "../avatar/look";
import type { AvatarInput, AvatarLook } from "../avatar/types";
import type { Levels } from "../levels/level-meter";

export const DRIVE_STEP = 1 / 32;

type EventBody = EventInput extends infer E ? (E extends { at: number } ? Omit<E, "at"> : never) : never;

export interface FrameScheduler {
  request(cb: (frameTime: number) => void): unknown;
  cancel(handle: unknown): void;
}

export interface FrameLoopDeps {
  scheduler: FrameScheduler;
  meter: { sample(): Levels; pause(): void; resume(): void };
  visibility: { isVisible(): boolean; subscribe(listener: (visible: boolean) => void): () => void };
  /** The non-time inputs, read each frame. */
  read: () => { state: AvatarState; micMuted: boolean; outputMuted: boolean; reducedMotion: boolean };
  publish: (look: AvatarLook, input: AvatarInput) => void;
  /** Told after every frame, with its Frame_Time and the latest look (for Electricity, sound and announcements). */
  onFrame?: (frameTime: number, look: AvatarLook, input: AvatarInput) => void;
}

const DISCRETE: readonly (keyof AvatarLook)[] = [
  "name", "ghost", "eyes", "glow", "posture", "bolts", "body", "bodyOpacity", "follows", "electric", "blur", "label",
];

export function lookChanged(prev: AvatarLook | null, next: AvatarLook): boolean {
  if (prev === null) return true;
  if (DISCRETE.some((k) => prev[k] !== next[k])) return true;
  return Math.abs(prev.drive - next.drive) >= DRIVE_STEP;
}

export class FrameLoop {
  private events: EventState = initialEventState;
  private levels: Levels = { input: 0, output: 0 };
  private handle: unknown = null;
  private running = false;
  private published: AvatarLook | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: FrameLoopDeps) {}

  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.deps.visibility.subscribe((visible) => (visible ? this.resume() : this.pause()));
    if (this.deps.visibility.isVisible()) this.resume();
    else this.deps.meter.pause();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pause();
  }

  /** Feeds a non-frame input at the latest Frame_Time, and publishes at once if the look changed. */
  input(body: EventBody): void {
    this.events = reduceEvents(this.events, { ...body, at: this.events.now ?? 0 } as EventInput);
    this.evaluate();
  }

  isRunning(): boolean {
    return this.running;
  }

  private resume(): void {
    if (this.running) return;
    this.running = true;
    this.deps.meter.resume();
    this.schedule();
  }

  private pause(): void {
    if (!this.running) return;
    this.running = false;
    if (this.handle !== null) this.deps.scheduler.cancel(this.handle);
    this.handle = null;
    this.deps.meter.pause();
  }

  private schedule(): void {
    this.handle = this.deps.scheduler.request((t) => this.frame(t));
  }

  private frame(frameTime: number): void {
    this.handle = null;
    if (!this.running) return;
    this.levels = this.deps.meter.sample();
    this.events = reduceEvents(this.events, { kind: "frame", at: frameTime });
    const { look, input } = this.evaluate();
    this.deps.onFrame?.(frameTime, look, input);
    this.schedule();
  }

  private evaluate(): { look: AvatarLook; input: AvatarInput } {
    const r = this.deps.read();
    if (r.state !== this.events.state) this.events = reduceEvents(this.events, { kind: "state", state: r.state, at: this.events.now ?? 0 });
    const ev = currentEvent(this.events);
    const input: AvatarInput = {
      state: r.state,
      micMuted: r.micMuted,
      outputMuted: r.outputMuted,
      inputLevel: this.levels.input,
      outputLevel: this.levels.output,
      event: ev.event,
      eventElapsedMs: ev.eventElapsedMs,
      firstConnecting: ev.firstConnecting,
      reducedMotion: r.reducedMotion,
    };
    const look = lookFor(input);
    if (lookChanged(this.published, look)) {
      this.published = look;
      this.deps.publish(look, input);
    }
    return { look, input };
  }
}

/** The browser's requestAnimationFrame as a FrameScheduler. */
export function browserScheduler(): FrameScheduler {
  return {
    request: (cb) => requestAnimationFrame(cb),
    cancel: (h) => cancelAnimationFrame(h as number),
  };
}
