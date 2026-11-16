/**
 * The X-ray's tracker (brief 051 part A): MediaPipe Tasks Vision behind a small port. `load()` makes the Face
 * Landmarker and the Hand Landmarker (the GPU first, the CPU second), `detect` reads one picture into an `XrayFrame`,
 * and `close()` lets both go. It decides nothing: the machine does.
 *
 * MediaPipe's JavaScript arrives through one `import()`, made only inside `load()`, so this module loads in Node and
 * in the page without it, and a refused camera downloads nothing (ruling 5). Its WebAssembly and models come from
 * the addresses in `ui/xray/sources.ts`. The turn from MediaPipe's results into an `XrayFrame` is `trackerFrame`, a
 * pure function.
 *
 * A Hand Landmarker that fails to load, or throws on a picture, leaves the face working (ruling 12). A Face
 * Landmarker that fails to load fails the load.
 */
import type {
  Classifications,
  FaceLandmarker,
  FaceLandmarkerResult,
  HandLandmarker,
  HandLandmarkerResult,
  Matrix,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { XRAY_FACE_MODEL, XRAY_HAND_MODEL, XRAY_WASM_BASE } from "../ui/xray/sources";
import type { XrayFace, XrayFrame, XrayHand, XrayPoint } from "../ui/xray/types";

export interface XrayTrackerPort {
  /** Load the tracker. Resolves when it can detect; rejects when it cannot. A `close()` during a load fails it. */
  load(): Promise<void>;
  /** Track one picture of `video`, taken at `at` (ms, monotonic). Throws when the tracker cannot read it. */
  detect(video: HTMLVideoElement, at: number): XrayFrame;
  /** Let the tracker go. Safe to call at any time, and twice. */
  close(): void;
}

/** One face (ruling 6). */
export const XRAY_MAX_FACES = 1;
/** Two hands (ruling 6). */
export const XRAY_MAX_HANDS = 2;

/**
 * MediaPipe names each hand as if the picture were mirrored (a selfie camera shown flipped), so on the unmirrored
 * picture its "Left" is its owner's right. True swaps the names back. One constant, so a test on a real hand can turn
 * it round.
 */
export const XRAY_HANDEDNESS_MIRRORED = true;

/** The picture's aspect when the element does not know its size yet. */
export const XRAY_FALLBACK_ASPECT = 16 / 9;

const EPS = 1e-6;

/**
 * A 4 by 4 matrix as 16 numbers, column by column. MediaPipe's JavaScript drops the layout it was packed in, so the
 * layout is read from where the move sits: a rigid placement has 0, 0, 0, 1 along its bottom row. With the move in
 * elements 3, 7 and 11 and zeros in 12 to 14, it arrived row by row and is turned. Null when it is not 4 by 4 or holds
 * a number that is not finite.
 */
export function matrixColumns(m: Pick<Matrix, "rows" | "columns" | "data"> | undefined): number[] | null {
  if (m === undefined || m.rows !== 4 || m.columns !== 4 || m.data.length !== 16 || !m.data.every(Number.isFinite)) return null;
  const d = m.data;
  const moveAtEnd = Math.abs(d[12]!) + Math.abs(d[13]!) + Math.abs(d[14]!) > EPS;
  const moveInRows = Math.abs(d[3]!) + Math.abs(d[7]!) + Math.abs(d[11]!) > EPS;
  if (moveInRows && !moveAtEnd) return [0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((r) => d[r * 4 + c]!));
  return [...d];
}

/** The `jawOpen` blendshape, 0 to 1; 0 when it is missing. */
export function jawOpen(shapes: Classifications | undefined): number {
  const score = shapes?.categories.find((c) => c.categoryName === "jawOpen")?.score;
  return typeof score === "number" && Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0;
}

/** A hand's side as its owner would say it, from MediaPipe's label. Null when the label is neither. */
export function handSide(label: string | undefined, mirrored = XRAY_HANDEDNESS_MIRRORED): XrayHand["side"] | null {
  const l = label?.trim().toLowerCase();
  if (l !== "left" && l !== "right") return null;
  if (!mirrored) return l;
  return l === "left" ? "right" : "left";
}

const point = (p: NormalizedLandmark): XrayPoint => ({ x: p.x, y: p.y, z: p.z });
const finitePoint = (p: NormalizedLandmark | undefined) => p !== undefined && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** The first face, or null when there is none or it cannot be placed. */
export function trackerFace(result: Pick<FaceLandmarkerResult, "faceLandmarks" | "faceBlendshapes" | "facialTransformationMatrixes"> | null): XrayFace | null {
  const points = result?.faceLandmarks[0];
  if (result === null || points === undefined || points.length === 0 || !points.every(finitePoint)) return null;
  const matrix = matrixColumns(result.facialTransformationMatrixes[0]);
  if (matrix === null) return null;
  return { matrix, points: points.map(point), jaw: jawOpen(result.faceBlendshapes[0]) };
}

/** Up to two hands with 21 joints and a known side. */
export function trackerHands(result: Pick<HandLandmarkerResult, "landmarks" | "handedness"> | null): XrayHand[] {
  if (result === null) return [];
  const out: XrayHand[] = [];
  result.landmarks.forEach((points, i) => {
    if (out.length >= XRAY_MAX_HANDS || points.length !== 21 || !points.every(finitePoint)) return;
    const side = handSide(result.handedness[i]?.[0]?.categoryName);
    if (side !== null) out.push({ points: points.map(point), side });
  });
  return out;
}

/** The picture's width over its height, or the fallback when the element does not know it. */
export function pictureAspect(width: number, height: number): number {
  return width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : XRAY_FALLBACK_ASPECT;
}

/** MediaPipe's results for one picture as an `XrayFrame`. Pure. */
export function trackerFrame(input: {
  at: number;
  width: number;
  height: number;
  face: Pick<FaceLandmarkerResult, "faceLandmarks" | "faceBlendshapes" | "facialTransformationMatrixes"> | null;
  hands: Pick<HandLandmarkerResult, "landmarks" | "handedness"> | null;
}): XrayFrame {
  return { at: input.at, aspect: pictureAspect(input.width, input.height), face: trackerFace(input.face), hands: trackerHands(input.hands) };
}

/** The part of the MediaPipe module the tracker uses. */
export type XrayVisionModule = Pick<typeof import("@mediapipe/tasks-vision"), "FilesetResolver" | "FaceLandmarker" | "HandLandmarker">;

export interface XrayTrackerDeps {
  /** Brings in MediaPipe. The live one is the lazy `import()`. */
  importVision: () => Promise<XrayVisionModule>;
  wasmBase?: string;
  faceModel?: string;
  handModel?: string;
}

/** The lazy import: MediaPipe's JavaScript is split out of the page and arrives only here. */
export const importMediapipe = (): Promise<XrayVisionModule> => import("@mediapipe/tasks-vision");

type Delegate = "GPU" | "CPU";

/** Make a task on the GPU, or on the CPU when the GPU fails. */
async function withDelegate<T>(make: (delegate: Delegate) => Promise<T>): Promise<T> {
  try {
    return await make("GPU");
  } catch {
    return make("CPU");
  }
}

export function createMediapipeTracker(deps: XrayTrackerDeps): XrayTrackerPort {
  const wasmBase = deps.wasmBase ?? XRAY_WASM_BASE;
  const faceModel = deps.faceModel ?? XRAY_FACE_MODEL;
  const handModel = deps.handModel ?? XRAY_HAND_MODEL;
  /** Raised by every load and every close; a load that finishes under another generation lets its tasks go. */
  let generation = 0;
  let face: FaceLandmarker | null = null;
  let hands: HandLandmarker | null = null;
  let last = -Infinity;

  const release = (f: FaceLandmarker | null, h: HandLandmarker | null) => {
    for (const t of [f, h]) {
      try {
        t?.close();
      } catch {
        // Already closed.
      }
    }
  };

  return {
    async load() {
      release(face, hands);
      face = null;
      hands = null;
      last = -Infinity;
      const mine = ++generation;
      const vision = await deps.importVision();
      const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
      const [f, h] = await Promise.allSettled([
        withDelegate((delegate) =>
          vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: faceModel, delegate },
            runningMode: "VIDEO",
            numFaces: XRAY_MAX_FACES,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
          }),
        ),
        withDelegate((delegate) =>
          vision.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: handModel, delegate },
            runningMode: "VIDEO",
            numHands: XRAY_MAX_HANDS,
          }),
        ),
      ]);
      const madeFace = f.status === "fulfilled" ? f.value : null;
      const madeHands = h.status === "fulfilled" ? h.value : null;
      if (mine !== generation || madeFace === null) {
        release(madeFace, madeHands);
        throw mine !== generation ? new Error("tracker closed while loading") : f.status === "rejected" ? f.reason : new Error("no face tracker");
      }
      face = madeFace;
      hands = madeHands;
    },
    detect(video, at) {
      if (face === null) throw new Error("tracker not loaded");
      // MediaPipe needs each picture's time to go up.
      const t = Math.max(at, last + 1);
      last = t;
      const faceResult = face.detectForVideo(video, t);
      let handResult: HandLandmarkerResult | null = null;
      if (hands !== null) {
        try {
          handResult = hands.detectForVideo(video, t);
        } catch {
          handResult = null;
        }
      }
      return trackerFrame({ at: t, width: video.videoWidth, height: video.videoHeight, face: faceResult, hands: handResult });
    },
    close() {
      generation++;
      release(face, hands);
      face = null;
      hands = null;
    },
  };
}
