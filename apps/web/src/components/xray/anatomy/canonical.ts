// MediaPipe's canonical head (brief 051 part C): the key points the skull is sized and pinned to.
// Source: `mediapipe/modules/face_geometry/data/canonical_face_model.obj` in github.com/google-ai-edge/mediapipe
// (Apache-2.0), read on 15 Nov 2026. That file's vertex order is the Face Landmarker's landmark order, so vertex N is
// landmark N. Its units are centimetres, +x the person's left, +y up, +z out of the face, the space XrayFace.matrix
// places in front of the camera. Only these few vertices are copied here; the file itself is not in the repo.
// Pure data.
import type { Vec3 } from "./bone-place";

/** The landmarks used, by name, with their index in the tracker's order. */
export const LANDMARK = {
  /** The nose tip. */
  noseTip: 1,
  /** The most forward point of the nose. */
  pronasale: 4,
  /** Between the eyes, at the bridge of the nose. */
  nasion: 168,
  /** The top of the forehead, at the hairline. */
  forehead: 10,
  /** The bottom of the chin. */
  chin: 152,
  /** The outer and inner eye corners: 33 and 133 the person's right eye, 263 and 362 their left. */
  rightEyeOuter: 33,
  rightEyeInner: 133,
  leftEyeOuter: 263,
  leftEyeInner: 362,
  /** The sides of the face, just in front of the ears: 234 the person's right, 454 their left. */
  rightSide: 234,
  leftSide: 454,
  /** The mouth corners: 61 the person's right, 291 their left. */
  rightMouth: 61,
  leftMouth: 291,
  /** The middle of the upper and the lower lip, where they meet. */
  upperLip: 13,
  lowerLip: 14,
} as const;

export type LandmarkName = keyof typeof LANDMARK;

/** Each named landmark's vertex in the canonical head, centimetres. */
export const CANONICAL: Readonly<Record<LandmarkName, Vec3>> = {
  noseTip: { x: 0, y: -1.126865, z: 7.475604 },
  pronasale: { x: 0, y: -0.46317, z: 7.58658 },
  nasion: { x: 0, y: 3.271027, z: 5.236015 },
  forehead: { x: 0, y: 8.261778, z: 4.481535 },
  chin: { x: 0, y: -9.403378, z: 4.264492 },
  rightEyeOuter: { x: -4.445859, y: 2.663991, z: 3.173422 },
  rightEyeInner: { x: -1.856432, y: 2.585245, z: 3.757904 },
  leftEyeOuter: { x: 4.445859, y: 2.663991, z: 3.173422 },
  leftEyeInner: { x: 1.856432, y: 2.585245, z: 3.757904 },
  rightSide: { x: -7.664182, y: 0.673132, z: -2.435867 },
  leftSide: { x: 7.664182, y: 0.673132, z: -2.435867 },
  rightMouth: { x: -2.456206, y: -4.342621, z: 4.283884 },
  leftMouth: { x: 2.456206, y: -4.342621, z: 4.283884 },
  upperLip: { x: 0, y: -3.994436, z: 5.219482 },
  lowerLip: { x: 0, y: -4.5424, z: 5.404754 },
};

/**
 * The points the screen correction lines up: the rigid upper face. The chin, the mouth and the lips move with the
 * jaw, which the matrix doesn't follow, so they would pull the fit down whenever the mouth opens.
 */
export const FIT_POINTS: readonly LandmarkName[] = ["noseTip", "nasion", "forehead", "rightEyeOuter", "rightEyeInner", "leftEyeOuter", "leftEyeInner", "rightSide", "leftSide"];

/**
 * The face's outline, landmark by landmark round the face from the top of the forehead: MediaPipe's face oval. The
 * veil over the flesh is drawn inside it, and the faint outline of the flesh along it.
 */
export const FACE_OVAL: readonly number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54,
  103, 67, 109,
];

/** The face oval's vertices in the canonical head, centimetres, in FACE_OVAL's order. */
export const CANONICAL_OVAL: readonly Vec3[] = [
  { x: 0, y: 8.261778, z: 4.481535 },
  { x: 1.891399, y: 8.236377, z: 4.274997 },
  { x: 3.523964, y: 8.005976, z: 3.729163 },
  { x: 5.133204, y: 7.485602, z: 2.660442 },
  { x: 6.279331, y: 6.615427, z: 1.42585 },
  { x: 7.08796, y: 5.434801, z: 0.09962 },
  { x: 7.555811, y: 4.106811, z: -0.991917 },
  { x: 7.743095, y: 2.364999, z: -2.005167 },
  { x: 7.664182, y: 0.673132, z: -2.435867 },
  { x: 7.542244, y: -1.049282, z: -2.431321 },
  { x: 7.270895, y: -2.890917, z: -2.252455 },
  { x: 6.719682, y: -4.788645, z: -1.745401 },
  { x: 5.940524, y: -6.223629, z: -0.631468 },
  { x: 5.085276, y: -7.17859, z: 0.714711 },
  { x: 4.068926, y: -7.993109, z: 1.925119 },
  { x: 3.210651, y: -8.533278, z: 2.802001 },
  { x: 2.308977, y: -8.974196, z: 3.60907 },
  { x: 1.292924, y: -9.29592, z: 4.094063 },
  { x: 0, y: -9.403378, z: 4.264492 },
  { x: -1.292924, y: -9.29592, z: 4.094063 },
  { x: -2.308977, y: -8.974196, z: 3.60907 },
  { x: -3.210651, y: -8.533278, z: 2.802001 },
  { x: -4.068926, y: -7.993109, z: 1.925119 },
  { x: -5.085276, y: -7.17859, z: 0.714711 },
  { x: -5.940524, y: -6.223629, z: -0.631468 },
  { x: -6.719682, y: -4.788645, z: -1.745401 },
  { x: -7.270895, y: -2.890917, z: -2.252455 },
  { x: -7.542244, y: -1.049282, z: -2.431321 },
  { x: -7.664182, y: 0.673132, z: -2.435867 },
  { x: -7.743095, y: 2.364999, z: -2.005167 },
  { x: -7.555811, y: 4.106811, z: -0.991917 },
  { x: -7.08796, y: 5.434801, z: 0.09962 },
  { x: -6.279331, y: 6.615427, z: 1.42585 },
  { x: -5.133204, y: 7.485602, z: 2.660442 },
  { x: -3.523964, y: 8.005976, z: 3.729163 },
  { x: -1.891399, y: 8.236377, z: 4.274997 },
];

/** How many landmarks the Face Landmarker gives: the 468 of the canonical head and 10 for the irises. */
export const FACE_POINT_COUNT = 478;
