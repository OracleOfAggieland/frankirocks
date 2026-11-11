// The shared rig context (brief 013, design note §3.2). New code. The prototype's top-level names become fields of
// one object per engine, `rc: Rig`. Each factory returns a Part, and buildRig merges it into the same object with
// Object.assign, so the shared uniform bags stay single objects and every later factory sees every earlier name.
// `size`, `clock` and `targets` are holders: created here once and only ever mutated in place.
import type { Acting } from "../../../ui/avatar/acting";
import type { EngineFailure } from "../../../ui/avatar/renderer-phase";
import type { FrameScheduler } from "../../../ui/hooks/frame-loop";
import type { AvatarAudioSource } from "../../../ui/levels/audio-source";
import { type ApplyPart, createApply } from "./apply";
import { type BrassPart, type BrassPrePart, createBrass, createBrassPre } from "./brass";
import { type CharacterPart, createCharacter } from "./character";
import { type ConfigPart, type EngineOptions, STILL_T, createConfig } from "./config";
import { disposeRig } from "./dispose";
import { EngineError } from "./errors";
import { type CatchPart, createCatch } from "./fx-catch";
import { type LightningPart, createLightning } from "./fx-lightning";
import { type SparksPart, createSparks } from "./fx-sparks";
import { type WorldFxPart, createWorldFx } from "./fx-world";
import { type HairPart, createHair } from "./hair";
import { type LoopPart, createLoop } from "./loop";
import { type BodyMaterialsPart, createBodyMaterials } from "./materials-body";
import { type HairBrassMaterialsPart, createHairBrassMaterials } from "./materials-hair-brass";
import { type RandomPart, createRandom } from "./math";
import { type MouthPart, createMouth } from "./mouth";
import { type ProbesPart, createProbes } from "./probe";
import { type QualityPart, createQuality } from "./quality";
import { type RigPart, createRig } from "./rig";
import { type StagePart, createStage } from "./stage";
import { type StatePart, createState } from "./state";
import { type SurfacePart, createSurface } from "./surface";
import { type UniformsPart, createUniforms } from "./uniforms";

/** CSS pixels of the canvas box. */
export interface Size {
  w: number;
  h: number;
}

/** ui/hooks/page-visible's VisibilityGate satisfies it. */
export interface Visibility {
  isVisible(): boolean;
  subscribe(listener: (visible: boolean) => void): () => void;
}

/** What the engine tells its host after it is ready. Before ready, failures reject createEngine instead. */
export type EngineEvent =
  | { kind: "lost" }
  /** The first good frame after a restore. */
  | { kind: "restored" }
  | { kind: "failed"; reason: EngineFailure; detail: string }
  /** Recorded, not fatal on its own: a frame error counts toward FRAME_ERROR_LIMIT; a shader error fails the engine. */
  | { kind: "error"; where: ErrorKind; detail: string };

export type ErrorKind = "shader" | "frame";

/** The engine's only ways out to the browser (three-host.ts builds it; tests fake it). */
export interface EngineHost {
  /** ui/hooks/frame-loop browserScheduler(): rAF timestamps are Frame_Time. */
  scheduler: FrameScheduler;
  visibility: Visibility;
  /** client/clock BrowserClock.mono(): CPU time and build timings only, never the animation clock. */
  mono(): number;
  /** Yields to the browser between build steps. */
  yieldNow(): Promise<void>;
  /** Read only while the matching gate in `targets` is open. */
  audio: AvatarAudioSource;
  onEvent(e: EngineEvent): void;
}

export interface HostPart {
  host: EngineHost;
  canvas: HTMLCanvasElement;
  size: Size;
  /** E4: the prototype's `T`, the only top-level `let` read across sections. Starts at STILL_T in still mode. */
  clock: { T: number };
  /** Written only by applyTargets, in place; read by state.ts, apply.ts and loop.ts. */
  targets: Acting;
  /** Newest last, at most 20; stats() reports them. */
  errors: string[];
  /** Replaces boot.record (258-259). The two kinds the ported ranges raise: 'shader' (809) and 'frame' (3360). */
  recordError(kind: ErrorKind, msg: string): void;
  /** 0 in the app: there is no dock, so frameAboveDock returns at once (3412). */
  dockTop(): number;
}

export const MAX_RECORDED_ERRORS = 20;

export function createHostPart(
  host: EngineHost,
  canvas: HTMLCanvasElement,
  size: Size,
  initial: Acting,
  opts: EngineOptions,
  onRecord: (kind: ErrorKind, msg: string) => void,
): HostPart {
  const errors: string[] = [];
  return {
    host,
    canvas,
    size,
    clock: { T: opts.still ? STILL_T : 0 },
    targets: { ...initial },
    errors,
    recordError(kind, msg) {
      errors.push(`${kind}: ${msg}`);
      if (errors.length > MAX_RECORDED_ERRORS) errors.shift();
      onRecord(kind, msg);
    },
    dockTop: () => 0,
  };
}

export type Rig = HostPart &
  ConfigPart &
  RandomPart &
  ProbesPart &
  StagePart &
  UniformsPart &
  BodyMaterialsPart &
  HairBrassMaterialsPart &
  SurfacePart &
  CharacterPart &
  BrassPart &
  HairPart &
  BrassPrePart &
  MouthPart &
  WorldFxPart &
  SparksPart &
  LightningPart &
  CatchPart &
  RigPart &
  StatePart &
  ApplyPart &
  QualityPart &
  LoopPart;

/** One name per factory, in build order. */
export const BUILD_STEPS = [
  "config",
  "random",
  "probes",
  "stage",
  "uniforms",
  "materials-body",
  "materials-hair-brass",
  "surface",
  "character",
  "brass",
  "hair",
  "brass-pre",
  "mouth",
  "fx-world",
  "fx-sparks",
  "fx-lightning",
  "fx-catch",
  "rig",
  "state",
  "apply",
  "quality",
  "loop",
] as const;

export type BuildStep = (typeof BUILD_STEPS)[number];

export interface StepTiming {
  name: BuildStep;
  ms: number;
}

/**
 * Runs the factories in the prototype's order, yielding to the browser between steps. Order is part of the look:
 * material ids come from three's global counter at construction and break ties in the opaque sort, and the seeded
 * streams are drawn in construction order. Checks the signal before and after every step. On any error it frees
 * what was built and rethrows as an EngineError (`build` unless the error already names a reason).
 */
export async function buildRig(
  host: EngineHost,
  canvas: HTMLCanvasElement,
  size: Size,
  initial: Acting,
  opts: EngineOptions,
  signal: AbortSignal,
  onRecord: (kind: ErrorKind, msg: string) => void,
): Promise<{ rig: Rig; steps: StepTiming[] }> {
  const steps: StepTiming[] = [];
  const rc0 = createHostPart(host, canvas, size, initial, opts, onRecord);

  async function step<R extends object, P extends object>(name: BuildStep, rc: R, make: (rc: R) => P): Promise<R & P> {
    if (signal.aborted) throw new EngineError("aborted", `before ${name}`);
    const t0 = host.mono();
    const part = make(rc);
    steps.push({ name, ms: host.mono() - t0 });
    const merged = Object.assign(rc, part);
    await host.yieldNow();
    if (signal.aborted) throw new EngineError("aborted", `after ${name}`);
    return merged;
  }

  try {
    const r1 = await step("config", rc0, () => createConfig(opts));
    const r2 = await step("random", r1, () => createRandom());
    const r3 = await step("probes", r2, () => createProbes());
    const r4 = await step("stage", r3, (rc) => createStage(rc));
    const r5 = await step("uniforms", r4, () => createUniforms());
    const r6 = await step("materials-body", r5, (rc) => createBodyMaterials(rc));
    const r7 = await step("materials-hair-brass", r6, (rc) => createHairBrassMaterials(rc));
    const r8 = await step("surface", r7, () => createSurface());
    const r9 = await step("character", r8, (rc) => createCharacter(rc));
    const r10 = await step("brass", r9, (rc) => createBrass(rc));
    const r11 = await step("hair", r10, (rc) => createHair(rc));
    const r12 = await step("brass-pre", r11, (rc) => createBrassPre(rc));
    const r13 = await step("mouth", r12, (rc) => createMouth(rc));
    const r14 = await step("fx-world", r13, (rc) => createWorldFx(rc));
    const r15 = await step("fx-sparks", r14, (rc) => createSparks(rc));
    const r16 = await step("fx-lightning", r15, (rc) => createLightning(rc));
    const r17 = await step("fx-catch", r16, (rc) => createCatch(rc));
    const r18 = await step("rig", r17, (rc) => createRig(rc));
    const r19 = await step("state", r18, (rc) => createState(rc));
    const r20 = await step("apply", r19, (rc) => createApply(rc));
    const r21 = await step("quality", r20, (rc) => createQuality(rc));
    const rig: Rig = await step("loop", r21, (rc) => createLoop(rc));
    return { rig, steps };
  } catch (e) {
    disposeQuietly(rc0);
    if (e instanceof EngineError) throw e;
    throw new EngineError("build", e instanceof Error ? e.message : String(e));
  }
}

/** Frees a partial build; a failure while freeing never hides the build's own error. */
function disposeQuietly(rc: Partial<Rig>): void {
  try {
    disposeRig(rc);
  } catch {
    // The build's error is the one that matters.
  }
}
