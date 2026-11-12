// The front door's story steps (brief 015). Pure types and constants, shared by the page (which picks the
// step from scroll position) and the stage (which acts it out). The order here is the scroll order.

export const STEP_IDS = ["hero", "talk", "noticed", "connected", "suggested", "approve", "yes", "result", "jar", "know", "forget"] as const;
export type StepId = (typeof STEP_IDS)[number];

/** The page sections that hold story steps. */
export type StorySection = "top" | "loop" | "memory";

export const STEP_SECTION: Record<StepId, StorySection> = {
  hero: "top",
  talk: "top",
  noticed: "loop",
  connected: "loop",
  suggested: "loop",
  approve: "loop",
  yes: "loop",
  result: "loop",
  jar: "memory",
  know: "memory",
  forget: "memory",
};

/** Every section of the page, in order: the rail has one terminal for each. */
export const SECTION_IDS = ["top", "loop", "memory", "rules", "build", "wake"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The states a visitor can pick in the "Talk. Don't type." step. */
export const TOY_STATES = ["listening", "thinking", "muted", "celebrate"] as const;
export type ToyState = (typeof TOY_STATES)[number];

/** What the page hands the stage. The stage owns everything drawn inside its box. */
export interface DemoStageProps {
  step: StepId;
  toy: ToyState;
  onToy: (next: ToyState) => void;
  /** The visitor tapped Yes on the approval card. The page scrolls to the `yes` step. */
  onYes: () => void;
  reduced: boolean;
}

/** What the page hands the switch at the foot of the page. */
export interface SwitchProps {
  /** Where the lab lives. */
  href: string;
  /** Called once, when the blade meets the contacts. */
  onThrown: () => void;
  reduced: boolean;
}

export function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && (STEP_IDS as readonly string[]).includes(value);
}
