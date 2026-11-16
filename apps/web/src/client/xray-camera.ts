/**
 * The X-ray's camera (brief 051 part A): the browser's camera behind a small port. It asks for video only, never
 * sound, with the facing as an ideal and 1280 by 720 as an ideal; it stops every track of a stream it is given; and it
 * says when a camera's track ends on its own. It decides nothing: the machine in `ui/xray/xray-machine.ts` does.
 *
 * Nothing runs at module scope. The picture is never recorded, copied or sent anywhere: the stream goes from here to
 * the store, and from the store to one video element.
 */
import type { XrayFacing } from "../ui/xray/types";

/** Why a camera could not be had: `blocked` (refused by the owner or the browser) or `noCamera` (anything else). */
export type XrayCameraFailure = "blocked" | "noCamera";

/** The error a refused `open` rejects with. */
export class XrayCameraError extends Error {
  constructor(readonly reason: XrayCameraFailure) {
    super(`camera ${reason}`);
    this.name = "XrayCameraError";
  }
}

export interface XrayCameraOpened {
  readonly stream: MediaStream;
  /** How many cameras the device has, at least 1. */
  readonly cameras: number;
}

export interface XrayCameraPort {
  /** Ask for a camera. Rejects with an XrayCameraError. */
  open(facing: XrayFacing): Promise<XrayCameraOpened>;
  /** Stop every track of `stream`. Safe to call twice. */
  stop(stream: MediaStream): void;
  /** Calls `listener` once when a video track of `stream` ends on its own. Returns the function that stops listening. */
  onEnded(stream: MediaStream, listener: () => void): () => void;
}

/** The part of `navigator.mediaDevices` the camera uses. */
export interface XrayMediaDevices {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices?(): Promise<readonly { kind: string }[]>;
}

/** The camera request: video only, the facing and the size as ideals. */
export function xrayConstraints(facing: XrayFacing): MediaStreamConstraints {
  return { audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } };
}

/** `NotAllowedError` and `SecurityError` are `blocked`; everything else is `noCamera`. */
export function xrayCameraFailure(err: unknown): XrayCameraFailure {
  const name = typeof err === "object" && err !== null && "name" in err ? (err as { name: unknown }).name : undefined;
  return name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "noCamera";
}

function stopAll(stream: MediaStream): void {
  for (const t of stream.getTracks()) {
    try {
      t.stop();
    } catch {
      // A track that cannot be stopped is already gone.
    }
  }
}

async function countCameras(media: XrayMediaDevices): Promise<number> {
  try {
    const devices = (await media.enumerateDevices?.()) ?? [];
    return Math.max(1, devices.filter((d) => d.kind === "videoinput").length);
  } catch {
    return 1;
  }
}

/** The browser camera. `media` is `navigator.mediaDevices`, which is undefined on a page that may not use one. */
export function createBrowserCamera(media: XrayMediaDevices | undefined): XrayCameraPort {
  return {
    async open(facing) {
      if (media === undefined || typeof media.getUserMedia !== "function") throw new XrayCameraError("noCamera");
      let stream: MediaStream;
      try {
        stream = await media.getUserMedia(xrayConstraints(facing));
      } catch (err) {
        throw new XrayCameraError(xrayCameraFailure(err));
      }
      if (stream.getVideoTracks().length === 0) {
        stopAll(stream);
        throw new XrayCameraError("noCamera");
      }
      // Devices are counted after the camera is allowed, when the browser lists them all.
      return { stream, cameras: await countCameras(media) };
    },
    stop: stopAll,
    onEnded: (stream, listener) => onTrackEnded(stream, listener),
  };
}

/** Shared by every camera port: one call when any video track of `stream` ends. */
export function onTrackEnded(stream: MediaStream, listener: () => void): () => void {
  let done = false;
  const tracks = stream.getVideoTracks();
  const fire = () => {
    if (done) return;
    done = true;
    off();
    listener();
  };
  const off = () => {
    for (const t of tracks) t.removeEventListener("ended", fire);
  };
  for (const t of tracks) t.addEventListener("ended", fire);
  return () => {
    done = true;
    off();
  };
}
