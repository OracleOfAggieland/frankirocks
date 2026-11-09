// The Look_Mapper (lab-ui-foundation R5, R6, R7, R8.2, R9.1, R9.2; design "Look_Mapper").
// Pure: no Wall_Clock_Read, no random source, no DOM, storage or network. The only code that decides
// an Avatar_Look.
import type { AvatarState } from "@franki/core";
import { AVATAR_LABELS } from "../copy";
import { EVENT_MS } from "../motion";
import type {
  AvatarAnimation,
  AvatarEvent,
  AvatarInput,
  AvatarLook,
  BodyMotion,
  Bolts,
  Eyes,
  Glow,
  LookName,
  Posture,
} from "./types";

export const LOOK_NAMES: readonly LookName[] = [
  "Dormant",
  "Waking",
  "Connecting",
  "Listening",
  "Thinking",
  "Speaking",
  "Recovery",
  "Presenting",
  "Awaiting_Approval",
  "Celebrate",
];

export const GHOST_OPACITY = 0.35;

interface LookRow {
  eyes: Eyes;
  glow: Glow;
  posture: Posture;
  bolts: Bolts;
  body: BodyMotion;
  electric: boolean;
  animations: readonly AvatarAnimation[];
}

const inf = (id: AvatarAnimation["id"]): AvatarAnimation => ({ id, iterations: "infinite" });
const once = (id: AvatarAnimation["id"], iterations = 1): AvatarAnimation => ({ id, iterations });

/** The look table: one row per Look_Name and motion setting. */
const TABLE: Record<LookName, { full: LookRow; reduced: LookRow }> = {
  Dormant: {
    full: { eyes: "closed", glow: "dim", posture: "sunk", bolts: "off", body: "breathe", electric: false, animations: [inf("float"), inf("breathe")] },
    reduced: { eyes: "closed", glow: "dim", posture: "sunk", bolts: "off", body: "still", electric: false, animations: [] },
  },
  Waking: {
    full: { eyes: "wide", glow: "flare", posture: "rising", bolts: "strike", body: "rise", electric: true, animations: [inf("float"), once("strike"), once("rise")] },
    reduced: { eyes: "wide", glow: "flare", posture: "rising", bolts: "glow", body: "still", electric: false, animations: [once("fade")] },
  },
  Connecting: {
    full: { eyes: "half", glow: "flicker", posture: "neutral", bolts: "flicker", body: "still", electric: true, animations: [inf("float"), inf("flicker")] },
    reduced: { eyes: "half", glow: "low", posture: "neutral", bolts: "glow", body: "still", electric: false, animations: [] },
  },
  Listening: {
    full: { eyes: "open", glow: "level", posture: "lean", bolts: "idle", body: "still", electric: false, animations: [inf("float"), inf("blink")] },
    reduced: { eyes: "open", glow: "level", posture: "lean", bolts: "idle", body: "still", electric: false, animations: [] },
  },
  Thinking: {
    full: { eyes: "glance-up", glow: "steady", posture: "neutral", bolts: "arc", body: "still", electric: true, animations: [inf("float"), inf("arc"), once("glance")] },
    reduced: { eyes: "glance-up", glow: "steady", posture: "neutral", bolts: "glow", body: "still", electric: false, animations: [] },
  },
  Speaking: {
    full: { eyes: "open", glow: "steady", posture: "neutral", bolts: "idle", body: "squish", electric: false, animations: [inf("float")] },
    reduced: { eyes: "open", glow: "steady", posture: "neutral", bolts: "idle", body: "still", electric: false, animations: [] },
  },
  Recovery: {
    full: { eyes: "squint", glow: "low", posture: "wobble", bolts: "fizzle", body: "wobble", electric: true, animations: [inf("float"), once("wobble", 2), once("fizzle")] },
    reduced: { eyes: "squint", glow: "low", posture: "wobble", bolts: "one-dark", body: "still", electric: false, animations: [] },
  },
  Presenting: {
    full: { eyes: "glance-card", glow: "steady", posture: "turn", bolts: "idle", body: "still", electric: false, animations: [inf("float"), once("glance")] },
    reduced: { eyes: "glance-card", glow: "steady", posture: "turn", bolts: "idle", body: "still", electric: false, animations: [once("fade")] },
  },
  Awaiting_Approval: {
    full: { eyes: "expectant", glow: "steady", posture: "nod", bolts: "idle", body: "nod", electric: false, animations: [inf("float"), inf("nod")] },
    reduced: { eyes: "expectant", glow: "steady", posture: "nod", bolts: "idle", body: "still", electric: false, animations: [] },
  },
  Celebrate: {
    full: { eyes: "happy", glow: "gold", posture: "rising", bolts: "sparks", body: "rise", electric: true, animations: [inf("float"), once("rise"), once("sparks")] },
    reduced: { eyes: "happy", glow: "gold", posture: "rising", bolts: "gold-glow", body: "still", electric: false, animations: [once("fade")] },
  },
};

/** R5.5: a level outside 0..1 or not finite counts as 0 (not clamped to the nearest bound). */
export function clampLevel(x: number): number {
  return Number.isFinite(x) && x >= 0 && x <= 1 ? x + 0 : 0; // `+ 0` turns -0 into 0
}

function sanitizeElapsed(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** Step 2: a timed event whose duration has passed counts as none (R8.2). */
export function effectiveEvent(event: AvatarEvent | null, elapsedMs: number): AvatarEvent | null {
  if (event === null || event === "await-approval") return event;
  return sanitizeElapsed(elapsedMs) >= EVENT_MS[event] ? null : event;
}

/** Step 3: the Look_Name by the fixed priority order. `micMuted` never changes it. */
export function lookNameFor(input: AvatarInput): LookName {
  const event = effectiveEvent(input.event, input.eventElapsedMs);
  if (input.state === "recovery") return "Recovery";
  if (input.state === "closed") return "Dormant";
  if (event === "wake" || (input.state === "connecting" && input.firstConnecting)) return "Waking";
  if (event === "celebrate") return "Celebrate";
  if (event === "present-card") return "Presenting";
  if (event === "await-approval") return "Awaiting_Approval";
  return stateLook(input.state, input.outputMuted);
}

function stateLook(state: Exclude<AvatarState, "recovery" | "closed">, outputMuted: boolean): LookName {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "speaking":
      return outputMuted ? "Thinking" : "Speaking";
  }
}

/** The accessible label, from the state alone (R5.4); speaking with output muted reads as thinking. */
export function labelFor(state: AvatarState, outputMuted: boolean): string {
  return state === "speaking" && outputMuted ? AVATAR_LABELS.thinking : AVATAR_LABELS[state];
}

/** The Look_Mapper. Returns exactly one Avatar_Look for any input and never throws (R5.2). */
export function lookFor(input: AvatarInput): AvatarLook {
  const name = lookNameFor(input);
  const row = TABLE[name][input.reducedMotion ? "reduced" : "full"];

  let follows: AvatarLook["follows"] =
    input.state === "listening" ? "input" : input.state === "speaking" && !input.outputMuted ? "output" : "none";
  if (name === "Recovery" || name === "Dormant" || name === "Waking") follows = "none";
  const drive = follows === "input" ? clampLevel(input.inputLevel) : follows === "output" ? clampLevel(input.outputLevel) : 0;
  const body: BodyMotion = follows === "output" && !input.reducedMotion ? "squish" : row.body;
  const ghost = input.micMuted === true;

  return {
    name,
    ghost,
    eyes: row.eyes,
    glow: row.glow,
    posture: row.posture,
    bolts: row.bolts,
    body,
    bodyOpacity: ghost ? GHOST_OPACITY : 1,
    eyeOpacity: 1,
    follows,
    drive,
    electric: row.electric,
    blur: !input.reducedMotion,
    animations: row.animations.map((a) => ({ ...a })),
    label: labelFor(input.state, input.outputMuted),
  };
}

const EYES: readonly Eyes[] = ["closed", "wide", "half", "open", "glance-up", "squint", "glance-card", "expectant", "happy"];
const GLOWS: readonly Glow[] = ["dim", "flare", "flicker", "level", "steady", "low", "gold"];
const POSTURES: readonly Posture[] = ["sunk", "rising", "neutral", "lean", "wobble", "turn", "nod"];
const BOLTS: readonly Bolts[] = ["off", "strike", "flicker", "idle", "arc", "fizzle", "sparks", "glow", "one-dark", "gold-glow"];
const BODIES: readonly BodyMotion[] = ["breathe", "rise", "still", "squish", "wobble", "nod"];
const ANIMATION_IDS = new Set(["float", "breathe", "blink", "strike", "rise", "flicker", "arc", "glance", "wobble", "fizzle", "nod", "sparks", "fade"]);
const LABELS = new Set(Object.values(AVATAR_LABELS));
const KEYS = [
  "name", "ghost", "eyes", "glow", "posture", "bolts", "body", "bodyOpacity", "eyeOpacity",
  "follows", "drive", "electric", "blur", "animations", "label",
].sort();

/** Closed validator for an Avatar_Look: exactly the known keys, every field in range. */
export function isAvatarLook(value: unknown): value is AvatarLook {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) return false;
  const inList = <T>(list: readonly T[], x: unknown) => list.includes(x as T);
  return (
    inList(LOOK_NAMES, v.name) &&
    typeof v.ghost === "boolean" &&
    inList(EYES, v.eyes) &&
    inList(GLOWS, v.glow) &&
    inList(POSTURES, v.posture) &&
    inList(BOLTS, v.bolts) &&
    inList(BODIES, v.body) &&
    (v.bodyOpacity === 1 || v.bodyOpacity === GHOST_OPACITY) &&
    v.bodyOpacity === (v.ghost ? GHOST_OPACITY : 1) &&
    v.eyeOpacity === 1 &&
    inList(["none", "input", "output"], v.follows) &&
    typeof v.drive === "number" &&
    Number.isFinite(v.drive) &&
    v.drive >= 0 &&
    v.drive <= 1 &&
    (v.follows !== "none" || v.drive === 0) &&
    typeof v.electric === "boolean" &&
    typeof v.blur === "boolean" &&
    Array.isArray(v.animations) &&
    v.animations.every(
      (a: unknown) =>
        typeof a === "object" &&
        a !== null &&
        Object.keys(a).length === 2 &&
        ANIMATION_IDS.has((a as AvatarAnimation).id) &&
        ((a as AvatarAnimation).iterations === "infinite" ||
          (Number.isInteger((a as AvatarAnimation).iterations) && ((a as AvatarAnimation).iterations as number) > 0)),
    ) &&
    typeof v.label === "string" &&
    LABELS.has(v.label)
  );
}
