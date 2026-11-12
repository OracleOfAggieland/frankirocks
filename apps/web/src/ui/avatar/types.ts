// Avatar types and the Avatar_Contract (lab-ui-foundation R4.1, design "Avatar types").
import type { AvatarState } from "@franki/core";
import type { ReactElement } from "react";

export type AvatarEvent = "wake" | "present-card" | "await-approval" | "celebrate";
export type TimedEvent = Exclude<AvatarEvent, "await-approval">;

export type LookName =
  | "Dormant"
  | "Waking"
  | "Connecting"
  | "Listening"
  | "Thinking"
  | "Speaking"
  | "Recovery"
  | "Presenting"
  | "Awaiting_Approval"
  | "Celebrate";
// Ghost_Mode is an overlay (AvatarLook.ghost), never a LookName (R6.11).

export interface AvatarInput {
  state: AvatarState;
  micMuted: boolean;
  outputMuted: boolean;
  /** 0..1 expected; anything else is treated as 0 (R5.5). */
  inputLevel: number;
  outputLevel: number;
  /** Decided by the Event_Controller. */
  event: AvatarEvent | null;
  /** Frame_Time since the event began; 0 when event is null. */
  eventElapsedMs: number;
  /** True only while the Visit's wake ritual runs. */
  firstConnecting: boolean;
  reducedMotion: boolean;
  /** Where Franki looks while listening: at the camera (the default when absent) or at the pointer. */
  attend?: "camera" | "pointer";
}

export type Eyes = "closed" | "wide" | "half" | "open" | "glance-up" | "squint" | "glance-card" | "expectant" | "happy";
export type Glow = "dim" | "flare" | "flicker" | "level" | "steady" | "low" | "gold";
export type Posture = "sunk" | "rising" | "neutral" | "lean" | "wobble" | "turn" | "nod";
export type Bolts = "off" | "strike" | "flicker" | "idle" | "arc" | "fizzle" | "sparks" | "glow" | "one-dark" | "gold-glow";
export type BodyMotion = "breathe" | "rise" | "still" | "squish" | "wobble" | "nod";
export type AnimationId =
  | "float"
  | "breathe"
  | "blink"
  | "strike"
  | "rise"
  | "flicker"
  | "arc"
  | "glance"
  | "wobble"
  | "fizzle"
  | "nod"
  | "sparks"
  | "fade";

export interface AvatarAnimation {
  id: AnimationId;
  iterations: number | "infinite";
}

export interface AvatarLook {
  name: LookName;
  /** True exactly when micMuted. */
  ghost: boolean;
  eyes: Eyes;
  glow: Glow;
  posture: Posture;
  bolts: Bolts;
  body: BodyMotion;
  /** 1, or 0.35 in Ghost_Mode. */
  bodyOpacity: number;
  eyeOpacity: 1;
  follows: "none" | "input" | "output";
  /** The followed level after sanitizing, 0..1; 0 when follows is "none". */
  drive: number;
  /** Any Electricity in this look. */
  electric: boolean;
  /** SVG blur filters for glows. */
  blur: boolean;
  animations: readonly AvatarAnimation[];
  /** Accessible label, from the state only (R5.4). */
  label: string;
}

/** The Avatar_Contract (R4.1). Every renderer implements it: the three.js ghost (the default) and the SVG ghost. */
export interface AvatarRendererProps {
  look: AvatarLook;
  input: AvatarInput;
}

export type AvatarRenderer = (props: AvatarRendererProps) => ReactElement;
