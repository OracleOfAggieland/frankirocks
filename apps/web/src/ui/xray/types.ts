// The X-ray machine's shared types (brief 051). Pure: no imports and no browser globals at run time (one DOM
// type is named, as a type only). The machine (ui/xray/xray-machine.ts), the store (client/xray-watch.ts), the
// machine on the stage (components/xray/XrayOnStage.tsx) and the X-ray screen (components/xray/XrayPanel.tsx)
// all code against this file.

export type XrayPower = "off" | "on";

/** Which camera is asked for. "user" faces the owner and is drawn mirrored; "environment" faces away. */
export type XrayFacing = "user" | "environment";

/**
 * What the machine's screen is doing.
 * - dark: the machine is off and no camera is open.
 * - asking: the machine was pressed and the browser has not handed over a camera yet.
 * - warming: the camera's picture is showing and the tracker has not loaded yet.
 * - searching: the tracker is running and finds no face and no hand in the picture.
 * - seeing: bones are being drawn on a face or a hand.
 * - filmOnly: the tracker could not load; the picture shows as film with no bones.
 * - blocked: the owner or the browser refused the camera.
 * - noCamera: there is no camera, the page may not use one, or the camera stopped on its own.
 * - paused: the tab was hidden, so the camera was turned off; a press starts it again.
 */
export type XraySignal = "dark" | "asking" | "warming" | "searching" | "seeing" | "filmOnly" | "blocked" | "noCamera" | "paused";

/** What the screen draws. Plain data, stable between changes. On means the X-ray screen is open. */
export interface XrayView {
  readonly power: XrayPower;
  readonly signal: XraySignal;
  readonly facing: XrayFacing;
  /** True when the device has another camera to flip to. */
  readonly canFlip: boolean;
  /** True while a camera stream is open, which is while the camera's own light is on. */
  readonly cameraOn: boolean;
}

export const XRAY_OFF_VIEW: XrayView = { power: "off", signal: "dark", facing: "user", canFlip: false, cameraOn: false };

/** What the machine on the stage needs. */
export interface XrayPropView {
  readonly power: XrayPower;
  readonly signal: XraySignal;
}

export function xrayPropView(view: XrayView): XrayPropView {
  return { power: view.power, signal: view.signal };
}

/** Everything the screen can ask of the machine. Each call is one event into the machine. */
export interface XrayControls {
  /** The machine on the stage was pressed. Off: on, and the camera is asked for. On: off. */
  press(): void;
  /** Turn the machine off: the camera stops and the screen closes. */
  close(): void;
  /** Use the other camera. Does nothing while off or when there is no other camera. */
  flip(): void;
  /** Ask for the camera again, from blocked, noCamera, paused or filmOnly. Called from a press. */
  retry(): void;
}

/**
 * A point the tracker found, measured on the camera's picture as the camera took it (never mirrored):
 * x runs 0 to 1 from the picture's left edge to its right, y runs 0 to 1 from its top to its bottom, and z is
 * depth in x's scale, measured from the part's own root (the wrist, or the middle of the head); smaller is nearer.
 */
export interface XrayPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The vertical field of view, in degrees, of the camera that XrayFace.matrix places the head in front of. */
export const XRAY_CAMERA_FOV = 63;

/** One tracked face. */
export interface XrayFace {
  /**
   * 16 numbers, column by column (three.js `Matrix4.fromArray` order, the move in elements 12 to 14). It places
   * the tracker's canonical head, measured in centimetres (+x the person's left, +y up, +z out of the face), in
   * front of a camera at the origin that looks down -z with +y up, XRAY_CAMERA_FOV degrees tall, at the
   * picture's own aspect.
   */
  readonly matrix: readonly number[];
  /** The face's landmarks in the tracker's own order (MediaPipe Face Landmarker: 478 points). */
  readonly points: readonly XrayPoint[];
  /** How far the jaw is open, 0 (shut) to 1. */
  readonly jaw: number;
}

/** One tracked hand. */
export interface XrayHand {
  /** 21 joints in MediaPipe's hand order: 0 wrist, 1 to 4 thumb, 5 to 8 index, 9 to 12 middle, 13 to 16 ring, 17 to 20 little. */
  readonly points: readonly XrayPoint[];
  /** Which hand it is, as its owner would say. */
  readonly side: "left" | "right";
}

/** What the tracker found in one picture. At most one face and two hands. */
export interface XrayFrame {
  /** Milliseconds on the tracker's own clock. It only goes up. */
  readonly at: number;
  /** The picture's width divided by its height. */
  readonly aspect: number;
  readonly face: XrayFace | null;
  readonly hands: readonly XrayHand[];
}

/**
 * The live picture, handed to the X-ray screen outside React state, since it changes every frame.
 * The store owns the camera; the screen owns the element that shows it.
 */
export interface XrayFeed {
  /**
   * Give the feed the element that shows the picture. While a camera is open the feed plays it in this element
   * and reads the tracker's pictures from it; when the camera stops, the feed empties the element. Returns the
   * function that takes the element back. One element at a time.
   */
  attach(video: HTMLVideoElement): () => void;
  /** The newest tracked frame, or null when there is none (before the first one, and whenever the camera is off). */
  latest(): XrayFrame | null;
}
