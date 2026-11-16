import { describe, expect, it } from "vitest";
import { FakeStream } from "./testing/xray-fakes";
import { XrayCameraError } from "./xray-camera";
import { XRAY_PICTURE_FPS, XRAY_PICTURE_MAX_SIDE, type XrayPictureDeps, createPictureCamera, createXrayHost, documentVisibility, watchPictures } from "./xray-live";
import type { XrayWatch } from "./xray-watch";

function frames() {
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    request: (cb: () => void) => {
      queue.set(next, cb);
      return next++;
    },
    cancel: (h: number) => queue.delete(h),
    run() {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb();
    },
    size: () => queue.size,
  };
}

describe("xray live: new pictures", () => {
  it("uses the element's own frame callback where there is one, skipping pictures with no size", () => {
    const f = frames();
    const video = { videoWidth: 0, currentTime: 0, requestVideoFrameCallback: f.request, cancelVideoFrameCallback: f.cancel };
    let n = 0;
    const stop = watchPictures(video, () => n++, { request: () => 0, cancel: () => {} });
    f.run();
    expect(n).toBe(0);
    video.videoWidth = 640;
    f.run();
    f.run();
    expect(n).toBe(2);
    stop();
    expect(f.size()).toBe(0);
  });

  it("otherwise counts animation frames whose picture time moved", () => {
    const f = frames();
    const video = { videoWidth: 640, currentTime: 0 };
    let n = 0;
    const stop = watchPictures(video, () => n++, f);
    f.run();
    f.run();
    expect(n).toBe(1);
    video.currentTime = 0.033;
    f.run();
    expect(n).toBe(2);
    stop();
    f.run();
    expect(n).toBe(2);
    expect(f.size()).toBe(0);
  });
});

describe("xray live: the tab", () => {
  it("reads hidden and listens for changes", () => {
    const listeners = new Set<() => void>();
    const doc = {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (_t: string, l: () => void) => listeners.add(l),
      removeEventListener: (_t: string, l: () => void) => listeners.delete(l),
    } as unknown as Document;
    const v = documentVisibility(doc);
    expect(v.hidden()).toBe(false);
    let n = 0;
    const off = v.onChange(() => n++);
    (doc as { visibilityState: string }).visibilityState = "hidden";
    for (const l of listeners) l();
    expect(v.hidden()).toBe(true);
    expect(n).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });
});

describe("xray live: the host", () => {
  it("makes one watch on start and disposes it on stop; a later start makes a new one", () => {
    let made = 0;
    let disposed = 0;
    const host = createXrayHost(() => {
      made++;
      return { dispose: () => disposed++ } as unknown as XrayWatch;
    });
    let notes = 0;
    host.subscribe(() => notes++);
    expect(host.getSnapshot()).toBeNull();
    host.start();
    host.start();
    const first = host.getSnapshot();
    expect(made).toBe(1);
    host.stop();
    host.stop();
    expect(disposed).toBe(1);
    expect(host.getSnapshot()).toBeNull();
    host.start();
    expect(host.getSnapshot()).not.toBe(first);
    expect(notes).toBe(3);
  });
});

function pictureDeps(opts: { fails?: boolean; width?: number; height?: number; noCapture?: boolean } = {}) {
  const drawn: number[][] = [];
  const intervals = new Map<number, () => void>();
  let id = 1;
  const stream = new FakeStream(9);
  let captured: number | undefined;
  const deps: XrayPictureDeps = {
    loadImage: () => (opts.fails ? Promise.reject(new Error("404")) : Promise.resolve({ width: opts.width ?? 2560, height: opts.height ?? 1440 } as unknown as HTMLImageElement)),
    makeCanvas: (width, height) =>
      ({
        width,
        height,
        getContext: () => ({ drawImage: (_i: unknown, x: number, y: number, w: number, h: number) => drawn.push([x, y, w, h]) }),
        captureStream: opts.noCapture
          ? undefined
          : (fps: number) => {
              captured = fps;
              return stream.asStream();
            },
      }) as unknown as HTMLCanvasElement,
    setInterval: (fn) => {
      intervals.set(id, fn);
      return id++;
    },
    clearInterval: (h) => intervals.delete(h as number),
  };
  return { deps, drawn, intervals, stream, captured: () => captured };
}

describe("xray live: the still picture camera", () => {
  it("plays the picture as a stream, scaled to fit, drawn again on a timer until stopped", async () => {
    const p = pictureDeps();
    const camera = createPictureCamera("https://pictures.test/a.jpg", p.deps);
    const opened = await camera.open("user");
    expect(opened).toEqual({ stream: p.stream.asStream(), cameras: 1 });
    expect(p.captured()).toBe(XRAY_PICTURE_FPS);
    expect(p.drawn[0]).toEqual([0, 0, XRAY_PICTURE_MAX_SIDE, 720]);
    for (const fn of p.intervals.values()) fn();
    expect(p.drawn).toHaveLength(2);
    camera.stop(opened.stream);
    expect(p.intervals.size).toBe(0);
    expect(p.stream.live).toBe(false);
  });

  it("a picture that does not load, or a canvas that cannot be captured, is noCamera", async () => {
    for (const opts of [{ fails: true }, { noCapture: true }]) {
      const err = await createPictureCamera("https://pictures.test/a.jpg", pictureDeps(opts).deps)
        .open("user")
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(XrayCameraError);
      expect((err as XrayCameraError).reason).toBe("noCamera");
    }
  });
});
