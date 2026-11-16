/**
 * The lab's live X-ray (brief 051 part A): the store with the browser's camera, the MediaPipe tracker, the window's
 * timers, a monotonic clock and the document's visibility; the one host for the app's life; and a camera port that
 * plays one still picture, so the specimens can run the real tracker on a photograph with no camera.
 *
 * Nothing here runs at module scope or during the server render: the screen calls `createLiveXray` inside an effect.
 */
import { createBrowserClock } from "./clock";
import { XrayCameraError, type XrayCameraPort, createBrowserCamera, onTrackEnded } from "./xray-camera";
import { createMediapipeTracker, importMediapipe } from "./xray-tracker";
import { type XrayTimers, type XrayVisibility, XrayWatch } from "./xray-watch";

/** The part of a video element the picture watch reads. */
export interface XrayPictureSource {
  videoWidth: number;
  currentTime: number;
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

export interface XrayFrameScheduler {
  request(cb: () => void): number;
  cancel(handle: number): void;
}

/**
 * Calls `fn` once for each new picture `video` shows: through the element's own frame callback where there is one,
 * otherwise on each animation frame whose picture time moved. A picture with no size yet is not counted.
 */
export function watchPictures(video: XrayPictureSource, fn: () => void, frames: XrayFrameScheduler): () => void {
  let stopped = false;
  if (typeof video.requestVideoFrameCallback === "function" && typeof video.cancelVideoFrameCallback === "function") {
    let handle = 0;
    const loop = () => {
      if (stopped) return;
      if (video.videoWidth > 0) fn();
      if (!stopped) handle = video.requestVideoFrameCallback!(loop);
    };
    handle = video.requestVideoFrameCallback(loop);
    return () => {
      stopped = true;
      video.cancelVideoFrameCallback!(handle);
    };
  }
  let last = Number.NaN;
  let handle = 0;
  const tick = () => {
    if (stopped) return;
    if (video.videoWidth > 0 && video.currentTime !== last) {
      last = video.currentTime;
      fn();
    }
    if (!stopped) handle = frames.request(tick);
  };
  handle = frames.request(tick);
  return () => {
    stopped = true;
    frames.cancel(handle);
  };
}

/** The window's timers, a monotonic clock, and new pictures. */
export function browserXrayTimers(): XrayTimers {
  const clock = createBrowserClock();
  const frames: XrayFrameScheduler = { request: (cb) => window.requestAnimationFrame(cb), cancel: (h) => window.cancelAnimationFrame(h) };
  return {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    now: () => clock.mono(),
    onNewPicture: (video, fn) => watchPictures(video as unknown as XrayPictureSource, fn, frames),
  };
}

/** The document's visibility. */
export function documentVisibility(doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">): XrayVisibility {
  return {
    hidden: () => doc.visibilityState === "hidden",
    onChange(listener) {
      doc.addEventListener("visibilitychange", listener);
      return () => doc.removeEventListener("visibilitychange", listener);
    },
  };
}

export interface LiveXrayOptions {
  /** Another camera, such as `createPictureCamera` on the specimens page. The browser's camera by default. */
  camera?: XrayCameraPort;
}

/** One X-ray for the app's life. */
export function createLiveXray(options: LiveXrayOptions = {}): XrayWatch {
  return new XrayWatch({
    camera: options.camera ?? createBrowserCamera(typeof navigator === "undefined" ? undefined : navigator.mediaDevices),
    tracker: createMediapipeTracker({ importVision: importMediapipe }),
    timers: browserXrayTimers(),
    visibility: documentVisibility(document),
  });
}

/** Holds the screen's one X-ray: made on `start`, disposed for good on `stop`; a later `start` makes a new one. */
export interface XrayHost {
  start(): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
  /** The X-ray while started; null before the first start and after a stop. */
  getSnapshot(): XrayWatch | null;
}

/**
 * The screen's X-ray holder, in the shape of `createRadioHost`. Cheap to make during render (it touches no browser
 * API until `start`), so the screen keeps it in state and starts it in an effect. Under StrictMode the effect runs
 * twice, and since `dispose()` is final, each start makes its own watch.
 */
export function createXrayHost(make: () => XrayWatch): XrayHost {
  let watch: XrayWatch | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    start() {
      if (watch !== null) return;
      watch = make();
      notify();
    },
    stop() {
      if (watch === null) return;
      watch.dispose();
      watch = null;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => watch,
  };
}

/** The still picture's longest side, in pixels. */
export const XRAY_PICTURE_MAX_SIDE = 1280;
/** How often the still picture is drawn again, so the tracker keeps getting new pictures. */
export const XRAY_PICTURE_FPS = 15;

/** What the picture camera needs from the page. */
export interface XrayPictureDeps {
  loadImage(url: string): Promise<CanvasImageSource & { width: number; height: number }>;
  makeCanvas(width: number, height: number): HTMLCanvasElement;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

function browserPictureDeps(): XrayPictureDeps {
  return {
    loadImage: (url) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        // The picture is drawn to a canvas that is captured, so it must be served with CORS.
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("picture did not load"));
        img.src = url;
      }),
    makeCanvas: (width, height) => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      return c;
    },
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (h) => window.clearInterval(h as number),
  };
}

/**
 * A camera port for the specimens that plays one still picture as a stream: the image is drawn to a canvas, and the
 * canvas is captured. The facing is ignored and the device has one camera. A picture that does not load, or a canvas
 * that cannot be captured, is `noCamera`. Nothing is kept after `stop`.
 */
export function createPictureCamera(url: string, deps: XrayPictureDeps = browserPictureDeps()): XrayCameraPort {
  const redraws = new Map<MediaStream, unknown>();
  return {
    async open() {
      let img: Awaited<ReturnType<XrayPictureDeps["loadImage"]>>;
      try {
        img = await deps.loadImage(url);
      } catch {
        throw new XrayCameraError("noCamera");
      }
      const scale = Math.min(1, XRAY_PICTURE_MAX_SIDE / Math.max(img.width, img.height, 1));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = deps.makeCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (ctx === null || typeof canvas.captureStream !== "function") throw new XrayCameraError("noCamera");
      const draw = () => ctx.drawImage(img, 0, 0, width, height);
      let stream: MediaStream;
      try {
        draw();
        stream = canvas.captureStream(XRAY_PICTURE_FPS);
      } catch {
        throw new XrayCameraError("noCamera");
      }
      redraws.set(stream, deps.setInterval(draw, 1000 / XRAY_PICTURE_FPS));
      return { stream, cameras: 1 };
    },
    stop(stream) {
      const r = redraws.get(stream);
      if (r !== undefined) deps.clearInterval(r);
      redraws.delete(stream);
      for (const t of stream.getTracks()) t.stop();
    },
    onEnded: onTrackEnded,
  };
}
