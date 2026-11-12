// The front door's stage script (brief 015, package H2). Pure. stageFor(step, toy, beat) says everything the
// stage shows: Franki's state, mute, event, speech and gaze; the strip; the source tags; the cards; the line
// being said; the jar, the Lab, the sheet, the forgotten item and the receipt; the state toy; the fig label
// and the plate. It follows the table in UI direction "The front door". Two steps have a second beat on the
// frame clock: Franki says the line, then listens; Franki forgets, then the receipt prints.
//
// The driver below turns a scene into the avatar's input on a frame clock, with the Event_Controller's pure
// reducer: Franki sleeps until the three.js layer reports it is showing (or the SVG ghost is the one that will
// stay), then wakes once; one-shots fire on entering a step, and a timed one goes to no event first so it plays
// again on re-entry.
import type { AvatarState } from "@franki/core";
import { type EventState, currentEvent, initialEventState, reduceEvents } from "../avatar/events";
import type { AvatarInput } from "../avatar/types";
import { LANDING } from "../copy-landing";
import { DUR, EVENT_MS } from "../motion";
import type { StripProps } from "../surface-props";
import { type VoicePlan, speechMs, wordsSpokenAt } from "./demo-voice";
import { type CardId, FORGOTTEN_ID, STRIP_RESULT, type TagId } from "./sample";
import { STEP_IDS, STEP_SECTION, type StepId, type ToyState } from "./steps";

/** A one-shot the scene asks for. `key` names the moment, so a new moment fires again. */
export type SceneEvent =
  | { kind: "present-card" | "celebrate"; key: string; repeatMs?: number }
  | { kind: "await-approval"; approvalId: string };

export interface SceneFranki {
  state: AvatarState;
  micMuted: boolean;
  event: SceneEvent | null;
  /** Franki is saying `line` out loud. */
  speaking: boolean;
}

/** How Franki sits on the stage: alone and large, above the state toy, or beside the equipment. */
export type StageLayout = "solo" | "toy" | "equip";
/** What fills the panel on the right (or the lower half of a narrow stage). */
export type StagePanel = "none" | "cards" | "sheet";

export interface StageScene {
  step: StepId;
  beat: number;
  franki: SceneFranki;
  strip: StripProps;
  /** Source tags floating beside Franki, in order. */
  tags: readonly TagId[];
  /** A stitched wire joins the tags. */
  wire: boolean;
  /** Front card first. */
  cards: readonly CardId[];
  /** The card whose Yes works, or null. */
  approval: CardId | null;
  /** What Franki is saying, or null. */
  line: string | null;
  jar: boolean;
  lab: boolean;
  sheet: boolean;
  /** The known item that has been forgotten, or null. */
  forgotten: string | null;
  receipt: boolean;
  /** The state toy's chips show, or not. */
  toy: boolean;
  fig: { n: string; text: string } | null;
  plate: boolean;
  /** The stage's chrome: the frame edge and its corner ticks. */
  frame: boolean;
  layout: StageLayout;
  panel: StagePanel;
}

const SAYS = LANDING.steps.suggested.says;
const LISTEN: SceneFranki = { state: "listening", micMuted: false, event: null, speaking: false };

/** Celebrate in the toy plays again after it ends and a short rest, while it stays picked. */
export const TOY_CELEBRATE_EVERY_MS = EVENT_MS.celebrate + DUR.ritual;

/** When each beat of a step starts, in frame-clock milliseconds after the step is entered. */
export function stageBeats(step: StepId): readonly number[] {
  if (step === "suggested") return [0, speechMs(SAYS) + DUR.base];
  if (step === "forget") return [0, DUR.ritual];
  return [0];
}

/** Pure. The beat a step is on `elapsedMs` after it was entered. */
export function beatAt(step: StepId, elapsedMs: number): number {
  const beats = stageBeats(step);
  let b = 0;
  for (let i = 1; i < beats.length; i++) if (elapsedMs >= beats[i]) b = i;
  return b;
}

/**
 * The frame clock's count for one visit to a step: which step and which visit (`entry` goes up each time the
 * step changes), when the visit started on the frame clock, its beat, and the words of the line said so far.
 */
export interface StepClock {
  step: StepId;
  entry: number;
  enteredAt: number | null;
  beat: number;
  spoken: number;
}

/** A clock for a visit that has not had a frame yet: beat 0, no words. */
export function freshClock(step: StepId, entry: number): StepClock {
  return { step, entry, enteredAt: null, beat: 0, spoken: 0 };
}

/**
 * Pure. One frame of the step clock. A new visit (another step, another entry, or no frame yet) starts again at
 * this frame, so every visit begins at beat 0 with no words said. Returns `prev` itself when nothing it shows
 * has changed, so the caller publishes only on a change.
 */
export function stepClock(prev: StepClock, f: { step: StepId; entry: number; at: number; plan: VoicePlan | null }): StepClock {
  const fresh = prev.step !== f.step || prev.entry !== f.entry || prev.enteredAt === null;
  const enteredAt = fresh ? f.at : (prev.enteredAt ?? f.at);
  const elapsed = Math.max(0, f.at - enteredAt);
  const beat = beatAt(f.step, elapsed);
  const spoken = f.plan === null ? 0 : wordsSpokenAt(f.plan, elapsed / 1000);
  if (!fresh && beat === prev.beat && spoken === prev.spoken) return prev;
  return { step: f.step, entry: f.entry, enteredAt, beat, spoken };
}

function toyFranki(toy: ToyState): SceneFranki {
  switch (toy) {
    case "listening":
      return LISTEN;
    case "thinking":
      return { ...LISTEN, state: "thinking" };
    case "muted":
      return { ...LISTEN, micMuted: true };
    case "celebrate":
      return { ...LISTEN, event: { kind: "celebrate", key: "toy", repeatMs: TOY_CELEBRATE_EVERY_MS } };
  }
}

const FILLED: Partial<Record<StepId, StripProps["filled"]>> = { noticed: 1, connected: 2, suggested: 3, approve: 3, yes: 4, result: 5 };

const EMPTY: Omit<StageScene, "step" | "beat" | "franki"> = {
  strip: { open: false, filled: 0, resultLabel: STRIP_RESULT },
  tags: [],
  wire: false,
  cards: [],
  approval: null,
  line: null,
  jar: false,
  lab: false,
  sheet: false,
  forgotten: null,
  receipt: false,
  toy: false,
  fig: null,
  plate: false,
  frame: false,
  layout: "solo",
  panel: "none",
};

/** Pure. Everything the stage shows at this step, toy pick and beat. A beat past the step's last is its last. */
export function stageFor(step: StepId, toy: ToyState, beat = 0): StageScene {
  const last = stageBeats(step).length - 1;
  const b = Math.max(0, Math.min(last, Math.floor(Number.isFinite(beat) ? beat : 0)));
  const scene = sceneFor(step, toy, b);
  const filled = FILLED[step];
  if (filled !== undefined) scene.strip = { open: true, filled, resultLabel: STRIP_RESULT };
  scene.plate = showsSample(scene);
  scene.frame = scene.plate;
  scene.layout = scene.frame ? "equip" : scene.toy ? "toy" : "solo";
  scene.panel = scene.sheet ? "sheet" : scene.cards.length > 0 ? "cards" : "none";
  if (scene.fig === null && scene.frame) scene.fig = { n: STEP_SECTION[step] === "memory" ? "3" : "2", text: LANDING.stage.fig };
  return scene;
}

function sceneFor(step: StepId, toy: ToyState, beat: number): StageScene {
  const base = { ...EMPTY, step, beat };
  switch (step) {
    case "hero":
      return { ...base, franki: LISTEN, fig: { n: "1", text: LANDING.hero.alive } };
    case "talk":
      return { ...base, franki: toyFranki(toy), toy: true };
    case "noticed":
      return { ...base, franki: { ...LISTEN, event: { kind: "present-card", key: "noticed" } }, tags: ["bank"] };
    case "connected":
      return { ...base, franki: { ...LISTEN, state: "thinking" }, tags: ["bank", "calendar"], wire: true };
    case "suggested":
      return beat === 0
        ? { ...base, franki: { ...LISTEN, state: "speaking", speaking: true }, cards: ["takeout"], line: SAYS }
        : { ...base, franki: LISTEN, cards: ["takeout"] };
    case "approve":
      return { ...base, franki: { ...LISTEN, event: { kind: "await-approval", approvalId: "dinners" } }, cards: ["dinners", "takeout"], approval: "dinners" };
    case "yes":
      return { ...base, franki: LISTEN, cards: ["list", "takeout"] };
    case "result":
      return { ...base, franki: { ...LISTEN, event: { kind: "celebrate", key: "result" } }, cards: ["weeks", "list", "takeout"] };
    case "jar":
      return { ...base, franki: { ...LISTEN, event: { kind: "present-card", key: "jar" } }, jar: true, lab: true };
    case "know":
      return { ...base, franki: LISTEN, jar: true, sheet: true };
    case "forget":
      return beat === 0
        ? { ...base, franki: { ...LISTEN, state: "thinking" }, jar: true, sheet: true, forgotten: FORGOTTEN_ID }
        : { ...base, franki: LISTEN, jar: true, lab: true, forgotten: FORGOTTEN_ID, receipt: true };
  }
}

/** Pure. Whether any sample datum shows: the plate goes with every one of them. */
export function showsSample(s: Pick<StageScene, "strip" | "tags" | "cards" | "line" | "jar" | "lab" | "sheet" | "receipt">): boolean {
  return s.strip.open || s.tags.length > 0 || s.cards.length > 0 || s.line !== null || s.jar || s.lab || s.sheet || s.receipt;
}

/** Every scene of the script, for tests and specimens: each step, toy pick and beat. */
export function allScenes(toys: readonly ToyState[]): StageScene[] {
  return STEP_IDS.flatMap((step) => toys.flatMap((toy) => stageBeats(step).map((_, b) => stageFor(step, toy, b))));
}

/** Pure. The CSS-facing name of the scene's layout, for the stage's data attributes. */
export function layoutKey(s: StageScene): string {
  return [s.layout, s.panel, s.strip.open ? "strip" : "", s.tags.length > 0 ? "tags" : "", s.jar ? "jar" : "", s.lab ? "lab" : "", s.line !== null || s.step === "suggested" ? "line" : ""].join("|");
}

// ---- The driver: a scene to the avatar's input, on a frame clock ----

/** How long Franki waits for the three.js layer before waking on the SVG ghost, in frame-clock milliseconds. */
export const WAKE_WAIT_MS = 6000;
/** Frames between clearing a one-shot and firing the next, so the look without it reaches the renderer. */
export const CLEAR_FRAMES = 2;

/** The three.js renderer's phase as read from `data-three-phase`, or null when there is none. */
export type RendererPhaseName = string | null;

/** Pure. What the wake waits on: wake now, stay asleep, or (under reduced motion) be awake with no wake at all. */
export function wakeDecision(phase: RendererPhaseName, waitedMs: number, reduced: boolean): "wake" | "wait" | "awake" {
  if (reduced) return "awake";
  // Three.js is showing, or will never show: the wake plays on whichever renderer is there to stay.
  if (phase === "three" || phase === "failed" || phase === "lost") return "wake";
  if (waitedMs >= WAKE_WAIT_MS) return "wake";
  return "wait";
}

export interface DriverState {
  events: EventState;
  /** The wake has fired, or Franki is simply awake under reduced motion. */
  awake: boolean;
  /** Frame time of the first frame. */
  firstAt: number | null;
  /** The scene event last fired, by key, and when. */
  fired: { key: string; at: number } | null;
  /** A one-shot waiting to fire after its predecessor was cleared: frames counted since the clear. */
  pending: { key: string; frames: number } | null;
}

/** The pending key that marks a one-shot cut because the scene stopped asking for it. No scene event has it. */
const CUT = "";

export const initialDriver: DriverState ={ events: initialEventState, awake: false, firstAt: null, fired: null, pending: null };

export function eventKey(e: SceneEvent | null): string | null {
  if (e === null) return null;
  return e.kind === "await-approval" ? `await:${e.approvalId}` : `${e.kind}:${e.key}`;
}

/** Pure. One frame of the driver: the clock, the wake, Franki's state, then the scene's one-shot. */
export function driverStep(prev: DriverState, f: { at: number; franki: SceneFranki; phase: RendererPhaseName; reduced: boolean }): DriverState {
  const at = f.at;
  let s: DriverState = { ...prev, events: reduceEvents(prev.events, { kind: "frame", at }), firstAt: prev.firstAt ?? at };
  const now = s.events.now ?? at;

  if (!s.awake) {
    const d = wakeDecision(f.phase, now - (s.firstAt ?? now), f.reduced);
    if (d === "awake") s = { ...s, awake: true };
    if (d === "wake") s = { ...s, awake: true, events: reduceEvents(s.events, { kind: "event", event: "wake", at: now }) };
  }

  const state: AvatarState = s.awake ? f.franki.state : "closed";
  if (s.events.state !== state) s = { ...s, events: reduceEvents(s.events, { kind: "state", state, at: now }) };
  if (!s.awake) return s;

  const want = f.franki.event;
  const key = eventKey(want);
  const timed = s.events.timed;
  const waking = timed?.event === "wake";

  // An approval being waited for that the scene no longer shows is done.
  if (s.events.awaiting !== null && (want?.kind !== "await-approval" || want.approvalId !== s.events.awaiting)) {
    s = { ...s, events: reduceEvents(s.events, { kind: "approvalDone", approvalId: s.events.awaiting, at: now }) };
  }

  if (want === null || key === null) {
    // The scene no longer asks for a one-shot: a running present-card or celebrate is cut, so the scene's own
    // state shows at once. The cut is marked pending, so a one-shot asked for on the very next frame still waits
    // out the clear.
    if (timed !== null && !waking) return { ...s, events: reduceEvents(s.events, { kind: "signOut", at: now }), fired: null, pending: { key: CUT, frames: 0 } };
    return { ...s, fired: null, pending: null };
  }

  if (want.kind === "await-approval") {
    if (s.events.awaiting === want.approvalId) return s.fired?.key === key ? s : { ...s, fired: { key, at: now }, pending: null };
    let events = s.events;
    // A running present-card or celebrate is cleared first, so the waiting look shows at once.
    if (timed !== null && !waking) events = reduceEvents(events, { kind: "signOut", at: now });
    events = reduceEvents(events, { kind: "await", approvalId: want.approvalId, at: now });
    return { ...s, events, fired: { key, at: now }, pending: null };
  }

  const due = s.fired?.key !== key || (want.repeatMs !== undefined && now - s.fired.at >= want.repeatMs);
  if (!due) return s;
  if (waking) return s; // the Event_Controller drops one-shots during the wake; this one waits for it to end

  if (s.pending?.key === key) {
    const frames = s.pending.frames + 1;
    if (frames < CLEAR_FRAMES) return { ...s, pending: { key, frames } };
    return fire(s, want.kind, key, now);
  }
  // A one-shot showing this frame or the last (even one that has just ended) is cleared first. The wake needs no
  // clearing: the look after it is never the wake again.
  const lastTimed = prev.events.timed !== null && prev.events.timed.event !== "wake";
  const justCut = s.pending?.key === CUT;
  if (timed !== null || lastTimed || justCut || s.events.awaiting !== null) {
    // Go to no event first: the renderer only replays a one-shot it sees start from another look.
    return { ...s, events: reduceEvents(s.events, { kind: "signOut", at: now }), pending: { key, frames: 0 } };
  }
  return fire(s, want.kind, key, now);
}

function fire(s: DriverState, event: "present-card" | "celebrate", key: string, now: number): DriverState {
  return { ...s, events: reduceEvents(s.events, { kind: "event", event, at: now }), fired: { key, at: now }, pending: null };
}

/** Pure. The avatar's input for the driver's state. Franki always attends to the pointer while listening. */
export function driverInput(s: DriverState, franki: SceneFranki, o: { reduced: boolean; outputLevel: number }): AvatarInput {
  const ev = currentEvent(s.events);
  const speaking = s.events.state === "speaking";
  return {
    state: s.events.state,
    micMuted: s.awake && franki.micMuted,
    outputMuted: false,
    inputLevel: 0,
    outputLevel: speaking && Number.isFinite(o.outputLevel) ? Math.max(0, Math.min(1, o.outputLevel)) : 0,
    event: ev.event,
    eventElapsedMs: ev.eventElapsedMs,
    firstConnecting: ev.firstConnecting,
    reducedMotion: o.reduced,
    attend: "pointer",
  };
}

/** The input for Franki asleep: the server render and the first paint. */
export function asleepInput(reduced: boolean): AvatarInput {
  return driverInput(initialDriver, LISTEN, { reduced, outputLevel: 0 });
}
