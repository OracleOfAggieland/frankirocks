// Fakes for the X-ray camera, tracker, timers and tab (brief 051 part A). Test-only: nothing in the app imports this.
import fc from "fast-check";
import type { XrayFrame } from "../../ui/xray/types";
import { XrayCameraError, type XrayCameraFailure, type XrayCameraOpened, type XrayCameraPort } from "../xray-camera";
import type { XrayTrackerPort } from "../xray-tracker";
import { type XrayTimers, type XrayVisibility, XrayWatch } from "../xray-watch";

/** A track that records whether it was stopped and can end on its own. */
export class FakeTrack {
  stopped = false;
  private readonly listeners = new Set<() => void>();
  constructor(readonly kind: "video" | "audio" = "video") {}
  stop(): void {
    this.stopped = true;
  }
  addEventListener(_type: string, l: () => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_type: string, l: () => void): void {
    this.listeners.delete(l);
  }
  end(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** A stream of fake tracks, cast to MediaStream where the port needs one. */
export class FakeStream {
  constructor(
    readonly id: number,
    readonly tracks: FakeTrack[] = [new FakeTrack()],
  ) {}
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }
  get live(): boolean {
    return this.tracks.some((t) => !t.stopped);
  }
  asStream(): MediaStream {
    return this as unknown as MediaStream;
  }
}

export const asFake = (s: MediaStream) => s as unknown as FakeStream;

interface PendingOpen {
  facing: string;
  resolve(v: XrayCameraOpened): void;
  reject(e: unknown): void;
}

/** A camera whose answers the test hands over, in any order, at any time. `log` records arrivals and stops. */
export class FakeCamera implements XrayCameraPort {
  readonly pending: PendingOpen[] = [];
  readonly streams: FakeStream[] = [];
  readonly log: string[] = [];
  private nextId = 1;

  open(facing: string): Promise<XrayCameraOpened> {
    return new Promise((resolve, reject) => this.pending.push({ facing, resolve, reject }));
  }
  stop(stream: MediaStream): void {
    const s = asFake(stream);
    if (s.live) this.log.push(`stop ${s.id}`);
    for (const t of s.tracks) t.stop();
  }
  onEnded(stream: MediaStream, listener: () => void): () => void {
    const t = asFake(stream).getVideoTracks()[0];
    if (t === undefined) return () => {};
    t.addEventListener("ended", listener);
    return () => t.removeEventListener("ended", listener);
  }
  /** Answers the pending request at `index` (taken from the list) with a new stream, or a refusal. */
  answer(index: number, answer: "ok" | XrayCameraFailure, cameras = 2): FakeStream | null {
    const p = this.pending.splice(index, 1)[0];
    if (p === undefined) return null;
    if (answer !== "ok") {
      p.reject(new XrayCameraError(answer));
      return null;
    }
    const s = new FakeStream(this.nextId++);
    this.streams.push(s);
    this.log.push(`arrive ${s.id}`);
    p.resolve({ stream: s.asStream(), cameras });
    return s;
  }
  liveCount(): number {
    return this.streams.filter((s) => s.live).length;
  }
}

/** A tracker whose loads the test settles, and whose detections it scripts. */
export class FakeTracker implements XrayTrackerPort {
  loads: { resolve(): void; reject(e: unknown): void }[] = [];
  loaded = false;
  closes = 0;
  detections = 0;
  /** What the next detections return or throw, front first; when empty, a frame with nothing found. */
  script: (XrayFrame | "throw" | "face" | "nothing")[] = [];
  load(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.loads.push({
        resolve: () => {
          this.loaded = true;
          resolve();
        },
        reject,
      }),
    );
  }
  detect(_video: HTMLVideoElement, at: number): XrayFrame {
    this.detections++;
    const next = this.script.shift();
    if (next === "throw") throw new Error("detect failed");
    if (next === "face") return { at, aspect: 16 / 9, face: { matrix: IDENTITY, points: [], jaw: 0 }, hands: [] };
    if (next === undefined || next === "nothing") return { at, aspect: 16 / 9, face: null, hands: [] };
    return next;
  }
  close(): void {
    this.closes++;
    this.loaded = false;
  }
  settle(index: number, ok: boolean): void {
    const l = this.loads.splice(index, 1)[0];
    if (l === undefined) return;
    if (ok) l.resolve();
    else l.reject(new Error("load failed"));
  }
}

export const IDENTITY: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Timers and new pictures driven by the test. */
export class FakeTimers implements XrayTimers {
  clock = 0;
  timers: { fn: () => void; at: number; id: number }[] = [];
  pictureWatchers: { video: HTMLVideoElement; fn: () => void }[] = [];
  private nextId = 1;
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ fn, at: this.clock + ms, id });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== h);
  }
  now(): number {
    return this.clock;
  }
  onNewPicture(video: HTMLVideoElement, fn: () => void): () => void {
    const w = { video, fn };
    this.pictureWatchers.push(w);
    return () => {
      this.pictureWatchers = this.pictureWatchers.filter((x) => x !== w);
    };
  }
  /** One new picture `ms` after the last. */
  picture(ms = 33): void {
    this.clock += ms;
    for (const w of [...this.pictureWatchers]) w.fn();
  }
  /** Runs the earliest timer. */
  fire(): boolean {
    this.timers.sort((a, b) => a.at - b.at);
    const t = this.timers.shift();
    if (t === undefined) return false;
    this.clock = Math.max(this.clock, t.at);
    t.fn();
    return true;
  }
}

/** The tab, hidden or shown by the test. */
export class FakeVisibility implements XrayVisibility {
  isHidden = false;
  listeners = new Set<() => void>();
  hidden(): boolean {
    return this.isHidden;
  }
  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  set(hidden: boolean): void {
    this.isHidden = hidden;
    for (const l of [...this.listeners]) l();
  }
}

/** A video element as the store uses it. */
export class FakeVideo {
  srcObject: MediaStream | null = null;
  plays = 0;
  play(): Promise<void> {
    this.plays++;
    return Promise.resolve();
  }
  asVideo(): HTMLVideoElement {
    return this as unknown as HTMLVideoElement;
  }
}

/** Lets every pending promise callback run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** One store with every fake, a video element attached, and every published change written to `camera.log`. */
export function xrayHarness() {
  const camera = new FakeCamera();
  const tracker = new FakeTracker();
  const timers = new FakeTimers();
  const visibility = new FakeVisibility();
  const video = new FakeVideo();
  const watch = new XrayWatch({ camera, tracker, timers, visibility });
  watch.subscribe(() => camera.log.push(`publish ${watch.getSnapshot().signal}`));
  let detach: (() => void) | null = watch.feed.attach(video.asVideo());
  return {
    camera,
    tracker,
    timers,
    visibility,
    video,
    watch,
    reattach() {
      detach?.();
      detach = watch.feed.attach(video.asVideo());
    },
    detach() {
      detach?.();
      detach = null;
    },
  };
}

export type XrayHarness = ReturnType<typeof xrayHarness>;

/** One thing that can happen to the store: an owner's control, an answer in any order, the tab, a picture, a timer. */
export type XrayAction =
  | { act: "press" | "close" | "flip" | "retry" | "hide" | "show" | "end" | "fire" | "reattach" | "detach" }
  | { act: "answer"; index: number; answer: "ok" | XrayCameraFailure; cameras: number }
  | { act: "settle"; index: number; ok: boolean }
  | { act: "picture"; what: "face" | "nothing" | "throw"; ms: number };

export const xrayActionArb: fc.Arbitrary<XrayAction> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom<XrayAction>({ act: "press" }, { act: "close" }, { act: "flip" }, { act: "retry" }) },
  { weight: 2, arbitrary: fc.constantFrom<XrayAction>({ act: "hide" }, { act: "show" }, { act: "end" }, { act: "fire" }, { act: "reattach" }, { act: "detach" }) },
  {
    weight: 4,
    arbitrary: fc
      .record({ index: fc.nat({ max: 3 }), answer: fc.constantFrom<"ok" | XrayCameraFailure>("ok", "ok", "blocked", "noCamera"), cameras: fc.integer({ min: 1, max: 3 }) })
      .map((r): XrayAction => ({ act: "answer", ...r })),
  },
  { weight: 2, arbitrary: fc.record({ index: fc.nat({ max: 2 }), ok: fc.boolean() }).map((r): XrayAction => ({ act: "settle", ...r })) },
  { weight: 3, arbitrary: fc.record({ what: fc.constantFrom<"face" | "nothing" | "throw">("face", "nothing", "throw"), ms: fc.integer({ min: 1, max: 900 }) }).map((r): XrayAction => ({ act: "picture", ...r })) },
);

/** Does one action, then lets every promise callback it caused run. Returns the stream a camera answer handed over. */
export async function act(h: XrayHarness, a: XrayAction): Promise<FakeStream | null> {
  let arrived: FakeStream | null = null;
  switch (a.act) {
    case "press":
    case "close":
    case "flip":
    case "retry":
      h.watch.controls[a.act]();
      break;
    case "hide":
      h.visibility.set(true);
      break;
    case "show":
      h.visibility.set(false);
      break;
    case "end":
      for (const s of h.camera.streams) if (s.live) s.getVideoTracks()[0]?.end();
      break;
    case "fire":
      h.timers.fire();
      break;
    case "reattach":
      h.reattach();
      break;
    case "detach":
      h.detach();
      break;
    case "answer":
      if (h.camera.pending.length > 0) arrived = h.camera.answer(a.index % h.camera.pending.length, a.answer, a.cameras);
      break;
    case "settle":
      if (h.tracker.loads.length > 0) h.tracker.settle(a.index % h.tracker.loads.length, a.ok);
      break;
    case "picture":
      h.tracker.script.push(a.what);
      h.timers.picture(a.ms);
      h.tracker.script.length = 0;
      break;
  }
  await flush();
  return arrived;
}
