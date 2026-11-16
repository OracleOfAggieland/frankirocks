import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XRAY_FACE_MODEL, XRAY_HAND_MODEL, XRAY_WASM_BASE } from "../ui/xray/sources";
import {
  XRAY_FALLBACK_ASPECT,
  type XrayVisionModule,
  createMediapipeTracker,
  handSide,
  jawOpen,
  matrixColumns,
  trackerFrame,
} from "./xray-tracker";

// A placement with a turn and a move: columns of a rotation about y by 90 degrees, then the move (1, 2, -30).
const COLUMNS = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 2, -30, 1];
const ROWS = [0, 0, 1, 1, 0, 1, 0, 2, -1, 0, 0, -30, 0, 0, 0, 1];
const lm = (x: number, y = 0.5, z = 0) => ({ x, y, z, visibility: 0 });
const hand21 = (x: number) => Array.from({ length: 21 }, (_, i) => lm(x + i / 100));
const face = (n = 478) => Array.from({ length: n }, (_, i) => lm(i / n));
const cat = (categoryName: string, score = 0.9) => ({ categoryName, score, index: 0, displayName: "" });

describe("xray tracker: MediaPipe's results as an XrayFrame", () => {
  it.each([
    ["column by column, as it is", { rows: 4, columns: 4, data: COLUMNS }, COLUMNS],
    ["row by row, turned", { rows: 4, columns: 4, data: ROWS }, COLUMNS],
    ["the identity, as it is", { rows: 4, columns: 4, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
    ["not 4 by 4: none", { rows: 3, columns: 3, data: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, null],
    ["16 numbers that say 3 by 3: none", { rows: 3, columns: 3, data: COLUMNS }, null],
    ["a number that is not finite: none", { rows: 4, columns: 4, data: [...COLUMNS.slice(0, 15), Number.NaN] }, null],
    ["missing: none", undefined, null],
  ])("the matrix: %s", (_why, m, expected) => {
    expect(matrixColumns(m)).toEqual(expected);
  });

  it.each([
    ["jawOpen's score", { categories: [cat("mouthSmileLeft", 0.2), cat("jawOpen", 0.42)], headIndex: 0, headName: "" }, 0.42],
    ["clamped above 1", { categories: [cat("jawOpen", 1.3)], headIndex: 0, headName: "" }, 1],
    ["clamped below 0", { categories: [cat("jawOpen", -0.1)], headIndex: 0, headName: "" }, 0],
    ["no jawOpen: shut", { categories: [cat("eyeBlinkLeft")], headIndex: 0, headName: "" }, 0],
    ["no blendshapes: shut", undefined, 0],
  ])("the jaw: %s", (_why, shapes, expected) => {
    expect(jawOpen(shapes)).toBe(expected);
  });

  it.each([
    ["Left", true, "right"],
    ["Right", true, "left"],
    ["left", false, "left"],
    [" Right ", false, "right"],
    ["", true, null],
    [undefined, true, null],
  ] as const)("the hand named %j (mirrored naming %s) is its owner's %s", (label, mirrored, expected) => {
    expect(handSide(label, mirrored)).toBe(expected);
  });

  it("a frame with a face, two hands, the jaw and the aspect", () => {
    const f = trackerFrame({
      at: 1000,
      width: 1280,
      height: 720,
      face: { faceLandmarks: [face()], faceBlendshapes: [{ categories: [cat("jawOpen", 0.5)], headIndex: 0, headName: "" }], facialTransformationMatrixes: [{ rows: 4, columns: 4, data: ROWS }] },
      hands: { landmarks: [hand21(0.1), hand21(0.6)], handedness: [[cat("Left")], [cat("Right")]] },
    });
    expect(f.at).toBe(1000);
    expect(f.aspect).toBeCloseTo(16 / 9);
    expect(f.face?.matrix).toEqual(COLUMNS);
    expect(f.face?.jaw).toBe(0.5);
    expect(f.face?.points).toHaveLength(478);
    expect(f.face?.points[0]).toEqual({ x: 0, y: 0.5, z: 0 });
    expect(f.hands.map((h) => h.side)).toEqual(["right", "left"]);
    expect(f.hands[0]?.points).toHaveLength(21);
  });

  it("a missing face is null; a face that cannot be placed is null", () => {
    expect(trackerFrame({ at: 0, width: 1, height: 1, face: { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] }, hands: null }).face).toBeNull();
    expect(trackerFrame({ at: 0, width: 1, height: 1, face: null, hands: null }).face).toBeNull();
    expect(trackerFrame({ at: 0, width: 1, height: 1, face: { faceLandmarks: [face()], faceBlendshapes: [], facialTransformationMatrixes: [] }, hands: null }).face).toBeNull();
    const nan = face();
    nan[3] = lm(Number.NaN);
    expect(trackerFrame({ at: 0, width: 1, height: 1, face: { faceLandmarks: [nan], faceBlendshapes: [], facialTransformationMatrixes: [{ rows: 4, columns: 4, data: COLUMNS }] }, hands: null }).face).toBeNull();
  });

  it("keeps at most two hands, each with 21 joints and a known side", () => {
    const f = trackerFrame({
      at: 0,
      width: 640,
      height: 480,
      face: null,
      hands: { landmarks: [hand21(0), hand21(0).slice(0, 20), hand21(0.2), hand21(0.4), hand21(0.6)], handedness: [[cat("Left")], [cat("Left")], [cat("Unknown")], [cat("Right")], [cat("Left")]] },
    });
    expect(f.hands.map((h) => [h.side, h.points[0]!.x])).toEqual([
      ["right", 0],
      ["left", 0.4],
    ]);
  });

  it("an element that does not know its size yet gets the fallback aspect", () => {
    expect(trackerFrame({ at: 0, width: 0, height: 0, face: null, hands: null }).aspect).toBe(XRAY_FALLBACK_ASPECT);
  });
});

/** A fake MediaPipe module, recording what it was asked. */
function fakeVision(opts: { gpuFails?: boolean; faceFails?: boolean; handFails?: boolean; handThrows?: boolean } = {}) {
  const log: string[] = [];
  const times: number[] = [];
  const task = (name: string, result: () => unknown) => ({
    detectForVideo: (_v: unknown, t: number) => {
      times.push(t);
      return result();
    },
    close: () => log.push(`close ${name}`),
  });
  const make = (name: "face" | "hand", fails: boolean | undefined, result: () => unknown) => ({
    createFromOptions: (_f: unknown, o: { baseOptions: { modelAssetPath: string; delegate: string }; runningMode: string; numFaces?: number; numHands?: number }) => {
      log.push(`${name} ${o.baseOptions.delegate} ${o.baseOptions.modelAssetPath} ${o.runningMode} ${o.numFaces ?? o.numHands}`);
      if (fails || (opts.gpuFails && o.baseOptions.delegate === "GPU")) return Promise.reject(new Error(`${name} failed`));
      return Promise.resolve(task(name, result));
    },
  });
  const vision = {
    FilesetResolver: { forVisionTasks: (base: string) => (log.push(`wasm ${base}`), Promise.resolve({})) },
    FaceLandmarker: make("face", opts.faceFails, () => ({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] })),
    HandLandmarker: make("hand", opts.handFails, () => {
      if (opts.handThrows) throw new Error("hand detect");
      return { landmarks: [hand21(0)], handedness: [[cat("Right")]], worldLandmarks: [], handednesses: [] };
    }),
  } as unknown as XrayVisionModule;
  let imports = 0;
  return { log, times, importVision: () => (imports++, Promise.resolve(vision)), imports: () => imports };
}

const video = { videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;

describe("xray tracker: the MediaPipe adapter", () => {
  it("imports nothing until load, then makes both tasks on the GPU from the named sources", async () => {
    const v = fakeVision();
    const t = createMediapipeTracker({ importVision: v.importVision });
    expect(v.imports()).toBe(0);
    await t.load();
    expect(v.imports()).toBe(1);
    expect(v.log).toEqual([`wasm ${XRAY_WASM_BASE}`, `face GPU ${XRAY_FACE_MODEL} VIDEO 1`, `hand GPU ${XRAY_HAND_MODEL} VIDEO 2`]);
  });

  it("falls back to the CPU when the GPU fails", async () => {
    const v = fakeVision({ gpuFails: true });
    await createMediapipeTracker({ importVision: v.importVision }).load();
    expect(v.log.filter((l) => l.includes("CPU"))).toHaveLength(2);
  });

  it("a face tracker that cannot load fails the load and lets the hands go", async () => {
    const v = fakeVision({ faceFails: true });
    await expect(createMediapipeTracker({ importVision: v.importVision }).load()).rejects.toThrow();
    expect(v.log).toContain("close hand");
  });

  it("a hand tracker that cannot load leaves the face working (ruling 12)", async () => {
    const v = fakeVision({ handFails: true });
    const t = createMediapipeTracker({ importVision: v.importVision });
    await t.load();
    expect(t.detect(video, 10)).toMatchObject({ face: null, hands: [], aspect: 640 / 480 });
  });

  it("a hand tracker that throws on a picture leaves the face working", async () => {
    const v = fakeVision({ handThrows: true });
    const t = createMediapipeTracker({ importVision: v.importVision });
    await t.load();
    expect(t.detect(video, 10).hands).toEqual([]);
  });

  it("sends MediaPipe a time that always goes up", async () => {
    const v = fakeVision();
    const t = createMediapipeTracker({ importVision: v.importVision });
    await t.load();
    expect(t.detect(video, 50).at).toBe(50);
    expect(t.detect(video, 50).at).toBe(51);
    expect(t.detect(video, 20).at).toBe(52);
    expect(t.detect(video, 100).hands[0]?.side).toBe("left");
  });

  it("detect before load, or after close, throws", async () => {
    const v = fakeVision();
    const t = createMediapipeTracker({ importVision: v.importVision });
    expect(() => t.detect(video, 0)).toThrow();
    await t.load();
    t.close();
    expect(v.log).toEqual(expect.arrayContaining(["close face", "close hand"]));
    expect(() => t.detect(video, 0)).toThrow();
  });

  it("a close during a load fails that load and lets its tasks go (ruling 14)", async () => {
    const v = fakeVision();
    const t = createMediapipeTracker({ importVision: v.importVision });
    const loading = t.load();
    t.close();
    await expect(loading).rejects.toThrow();
    expect(v.log).toEqual(expect.arrayContaining(["close face", "close hand"]));
    expect(() => t.detect(video, 0)).toThrow();
  });

  it("brings MediaPipe in only through a lazy import", () => {
    const src = readFileSync(new URL("./xray-tracker.ts", import.meta.url), "utf8");
    const statics = src.split("\n").filter((l) => /^import\s/.test(l) && l.includes("@mediapipe/tasks-vision"));
    expect(statics.every((l) => l.startsWith("import type"))).toBe(true);
    // The multi-line type import is a type import too.
    expect(src).toMatch(/^import type \{[^}]*\} from "@mediapipe\/tasks-vision";/m);
    expect(src.match(/import\("@mediapipe\/tasks-vision"\)/g)?.length).toBe(2);
  });
});
