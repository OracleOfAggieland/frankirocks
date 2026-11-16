/**
 * Where the X-ray's tracker comes from (brief 051, ruling 5). The tracker's JavaScript is the installed
 * `@mediapipe/tasks-vision` package; its WebAssembly comes from jsDelivr at that same version, and its two models
 * from Google's public model storage. Hosting them ourselves later is a change to this file only.
 */

/** The installed `@mediapipe/tasks-vision` version. A test pins it to the package and to the address below. */
export const XRAY_TRACKER_VERSION = "1.2.3";

/** The folder holding `vision_wasm_internal.js` and `.wasm`, for FilesetResolver.forVisionTasks. */
export const XRAY_WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";

/** Face Landmarker, float16, version 1 (478 points, blendshapes, the head's matrix). */
export const XRAY_FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** Hand Landmarker, float16, version 1 (21 joints a hand). */
export const XRAY_HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
