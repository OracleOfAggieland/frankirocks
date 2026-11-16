/**
 * The X-ray's store (brief 051 part A), in the shape of `radio-watch.ts`: the screen subscribes, reads an `XrayView`,
 * calls `controls`, and hands its video element to `feed`. Every change is `xrayStep`; what the camera, the tracker
 * and the load limit must do is the step's commands, run here in order. The store holds the one camera stream the
 * machine says is open, plays it in the attached element, and runs the tracker once for each new picture of that
 * element (never two at once, never while the tab is hidden).
 *
 * Off means off: a step that turns the machine off, or a hidden tab, stops every track in that same step, and a
 * camera the browser hands over for an older session is stopped before anything else happens. Nothing is stored and
 * nothing leaves the browser: the stream goes from the camera port to one video element and to the tracker.
 */
import {
  INITIAL_XRAY,
  XRAY_LOAD_LIMIT_MS,
  type XrayCommand,
  type XrayEvent,
  type XrayState,
  xrayDetecting,
  xrayStep,
  xrayView,
} from "../ui/xray/xray-machine";
import type { XrayControls, XrayFeed, XrayFrame, XrayView } from "../ui/xray/types";
import { XrayCameraError, type XrayCameraOpened, type XrayCameraPort } from "./xray-camera";
import type { XrayTrackerPort } from "./xray-tracker";

/** Ruling 13: "seeing" holds this long after the last picture with a face or a hand in it. */
export const XRAY_SEEN_MEMORY_MS = 600;
/** This many thrown detections in a row count as a failed tracker. */
export const XRAY_DETECT_FAILURE_LIMIT = 3;

export interface XrayTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Monotonic milliseconds. */
  now(): number;
  /** Calls `fn` once for each new picture `video` shows, until the returned function is called. */
  onNewPicture(video: HTMLVideoElement, fn: () => void): () => void;
}

/** The tab's visibility. */
export interface XrayVisibility {
  hidden(): boolean;
  onChange(listener: () => void): () => void;
}

export interface XrayWatchDeps {
  camera: XrayCameraPort;
  tracker: XrayTrackerPort;
  timers: XrayTimers;
  visibility: XrayVisibility;
}

interface Held {
  readonly session: number;
  readonly stream: MediaStream;
  readonly offEnded: () => void;
}

export class XrayWatch {
  private state: XrayState = INITIAL_XRAY;
  private view: XrayView = xrayView(INITIAL_XRAY);
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private readonly queue: XrayEvent[] = [];
  private running = false;
  /** A camera stream that arrived and waits for its step, keyed by session. */
  private arriving: { session: number; stream: MediaStream } | null = null;
  private held: Held | null = null;
  private video: HTMLVideoElement | null = null;
  private loadLimit: unknown = null;
  private stopPictures: (() => void) | null = null;
  private detecting = false;
  private frame: XrayFrame | null = null;
  private lastSeenAt = -Infinity;
  private failures = 0;
  private readonly offVisibility: () => void;

  constructor(private readonly deps: XrayWatchDeps) {
    this.offVisibility = deps.visibility.onChange(() => this.send({ kind: deps.visibility.hidden() ? "hidden" : "shown" }));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): XrayView => this.view;

  readonly controls: XrayControls = {
    press: () => this.send({ kind: "press" }),
    close: () => this.send({ kind: "close" }),
    flip: () => this.send({ kind: "flip" }),
    retry: () => this.send({ kind: "retry" }),
  };

  readonly feed: XrayFeed = {
    attach: (video) => {
      if (this.video !== null && this.video !== video) this.empty(this.video);
      this.video = video;
      this.show();
      this.syncPictures();
      return () => {
        if (this.video !== video) return;
        this.empty(video);
        this.video = null;
        this.syncPictures();
      };
    },
    latest: () => (this.held === null ? null : this.frame),
  };

  /** The app is going away: every camera track stops, the tracker closes, and nothing more is reported. */
  dispose(): void {
    if (this.disposed) return;
    this.send({ kind: "close" });
    this.disposed = true;
    this.release();
    this.deps.tracker.close();
    this.clearLoadLimit();
    this.offVisibility();
    if (this.video !== null) this.empty(this.video);
    this.video = null;
    this.listeners.clear();
  }

  private send(e: XrayEvent): void {
    if (this.disposed) return;
    this.queue.push(e);
    if (this.running) return;
    this.running = true;
    try {
      for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) this.apply(next);
    } finally {
      this.running = false;
    }
  }

  private apply(e: XrayEvent): void {
    const before = this.state;
    const { state, commands } = xrayStep(before, e);
    this.state = state;
    // A camera the machine now counts as open is the one that just arrived: it is held before the tracker loads.
    const a = this.arriving;
    if (a !== null && state.cameraOpen && !before.cameraOpen && state.session === a.session) this.take(a);
    for (const c of commands) this.run(c);
    // A stream that arrived and was neither taken nor handed back is stopped: nothing is left live by accident.
    if (this.arriving !== null) {
      this.deps.camera.stop(this.arriving.stream);
      this.arriving = null;
    }
    if (state === before) return;
    this.syncPictures();
    this.publish();
  }

  private run(c: XrayCommand): void {
    switch (c.kind) {
      case "dropStream":
        if (this.arriving !== null && this.arriving.session === c.session) {
          this.deps.camera.stop(this.arriving.stream);
          this.arriving = null;
        }
        break;
      case "stopCamera":
        this.release();
        break;
      case "openCamera":
        this.openCamera(c.session, c.facing);
        break;
      case "loadTracker":
        this.loadTracker(c.session);
        break;
      case "closeTracker":
        this.deps.tracker.close();
        this.failures = 0;
        break;
      case "armLoadLimit": {
        this.clearLoadLimit();
        const session = c.session;
        this.loadLimit = this.deps.timers.setTimeout(() => {
          this.loadLimit = null;
          this.send({ kind: "tracker", session, report: "timedOut" });
        }, XRAY_LOAD_LIMIT_MS);
        break;
      }
      case "clearLoadLimit":
        this.clearLoadLimit();
        break;
      default:
        c satisfies never;
    }
  }

  private openCamera(session: number, facing: XrayState["facing"]): void {
    let answer: Promise<XrayCameraOpened>;
    try {
      answer = this.deps.camera.open(facing);
    } catch (err) {
      answer = Promise.reject(err);
    }
    answer.then(
      (opened) => this.arrive(session, opened),
      (err: unknown) => {
        const report = err instanceof XrayCameraError ? err.reason : "noCamera";
        this.send({ kind: "camera", session, report });
      },
    );
  }

  private arrive(session: number, opened: XrayCameraOpened): void {
    if (this.disposed) {
      this.deps.camera.stop(opened.stream);
      return;
    }
    // Answers arrive from promise callbacks, never inside a step, so this step runs now and settles the stream.
    this.arriving = { session, stream: opened.stream };
    this.send({ kind: "camera", session, report: "opened", cameras: opened.cameras });
  }

  private take(a: { session: number; stream: MediaStream }): void {
    this.arriving = null;
    const offEnded = this.deps.camera.onEnded(a.stream, () => this.send({ kind: "camera", session: a.session, report: "ended" }));
    this.held = { session: a.session, stream: a.stream, offEnded };
    this.frame = null;
    this.lastSeenAt = -Infinity;
    this.failures = 0;
    this.show();
  }

  private release(): void {
    const h = this.held;
    this.held = null;
    this.frame = null;
    if (h === null) return;
    h.offEnded();
    if (this.video !== null) this.empty(this.video);
    this.deps.camera.stop(h.stream);
  }

  private show(): void {
    const v = this.video;
    if (v === null || this.held === null || v.srcObject === this.held.stream) return;
    v.srcObject = this.held.stream;
    try {
      void v.play()?.catch(() => {});
    } catch {
      // The element plays when it can; `autoplay` on the element covers a refused play().
    }
  }

  private empty(v: HTMLVideoElement): void {
    if (v.srcObject !== null) v.srcObject = null;
  }

  private loadTracker(session: number): void {
    let loading: Promise<void>;
    try {
      loading = this.deps.tracker.load();
    } catch (err) {
      loading = Promise.reject(err);
    }
    loading.then(
      () => this.send({ kind: "tracker", session, report: "ready" }),
      () => this.send({ kind: "tracker", session, report: "failed" }),
    );
  }

  private clearLoadLimit(): void {
    if (this.loadLimit !== null) this.deps.timers.clearTimeout(this.loadLimit);
    this.loadLimit = null;
  }

  /** Watch for new pictures exactly while the machine says to track, a camera is held and an element shows it. */
  private syncPictures(): void {
    const want = !this.disposed && xrayDetecting(this.state) && this.held !== null && this.video !== null && !this.deps.visibility.hidden();
    if (!want) {
      this.stopPictures?.();
      this.stopPictures = null;
      return;
    }
    if (this.stopPictures !== null) return;
    const video = this.video!;
    this.stopPictures = this.deps.timers.onNewPicture(video, () => this.picture(video));
  }

  private picture(video: HTMLVideoElement): void {
    if (this.detecting || this.disposed || this.video !== video || !xrayDetecting(this.state) || this.deps.visibility.hidden()) return;
    const session = this.state.session;
    const at = this.deps.timers.now();
    this.detecting = true;
    let frame: XrayFrame | null = null;
    try {
      frame = this.deps.tracker.detect(video, at);
    } catch {
      frame = null;
    } finally {
      this.detecting = false;
    }
    if (frame === null) {
      this.failures++;
      if (this.failures >= XRAY_DETECT_FAILURE_LIMIT) {
        this.failures = 0;
        this.send({ kind: "tracker", session, report: "failed" });
      }
      return;
    }
    this.failures = 0;
    this.frame = frame;
    const something = frame.face !== null || frame.hands.length > 0;
    if (something) {
      this.lastSeenAt = at;
      if (this.state.signal === "searching") this.send({ kind: "tracker", session, report: "found" });
    } else if (this.state.signal === "seeing" && at - this.lastSeenAt >= XRAY_SEEN_MEMORY_MS) {
      this.send({ kind: "tracker", session, report: "lost" });
    }
  }

  private publish(): void {
    const next = xrayView(this.state);
    const v = this.view;
    if (next.power === v.power && next.signal === v.signal && next.facing === v.facing && next.canFlip === v.canFlip && next.cameraOn === v.cameraOn) return;
    this.view = next;
    for (const l of this.listeners) l();
  }
}
