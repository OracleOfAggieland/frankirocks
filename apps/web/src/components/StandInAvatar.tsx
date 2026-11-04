import type { AvatarState } from "@franki/core";

/**
 * The Stand_In_Avatar (R16.1–R16.3): plain HTML and CSS, no Rive, no image, video or canvas. Six states, each
 * differing from every other in at least one non-text property (shape, size, colour or animation). The state
 * name is the accessible label. Rive replaces this in a later feature.
 */
export const AVATAR_STATES: readonly AvatarState[] = ["closed", "connecting", "listening", "thinking", "speaking", "recovery"];

export interface AvatarStyle {
  shape: "circle" | "rounded" | "diamond";
  size: "sm" | "md" | "lg";
  colour: string;
  animation: "none" | "spin" | "pulse" | "bounce" | "ping";
}

export const AVATAR_STYLES: Record<AvatarState, AvatarStyle> = {
  closed: { shape: "circle", size: "sm", colour: "bg-zinc-600", animation: "none" },
  connecting: { shape: "circle", size: "md", colour: "bg-amber-400", animation: "spin" },
  listening: { shape: "circle", size: "md", colour: "bg-emerald-400", animation: "pulse" },
  thinking: { shape: "rounded", size: "md", colour: "bg-indigo-400", animation: "bounce" },
  speaking: { shape: "circle", size: "lg", colour: "bg-sky-400", animation: "ping" },
  recovery: { shape: "diamond", size: "md", colour: "bg-red-500", animation: "none" },
};

const SHAPE: Record<AvatarStyle["shape"], string> = { circle: "rounded-full", rounded: "rounded-2xl", diamond: "rotate-45 rounded-md" };
const SIZE: Record<AvatarStyle["size"], string> = { sm: "h-16 w-16", md: "h-24 w-24", lg: "h-32 w-32" };
const ANIMATION: Record<AvatarStyle["animation"], string> = {
  none: "",
  spin: "animate-spin border-4 border-dashed border-amber-100",
  pulse: "animate-pulse",
  bounce: "animate-bounce",
  ping: "",
};

export function avatarClasses(state: AvatarState): string {
  const s = AVATAR_STYLES[state];
  return [SHAPE[s.shape], SIZE[s.size], s.colour, ANIMATION[s.animation]].filter((c) => c !== "").join(" ");
}

export function StandInAvatar({ state }: { state: AvatarState }) {
  const style = AVATAR_STYLES[state];
  return (
    <div role="img" aria-label={`Franki is ${state}`} data-state={state} className="relative flex h-36 w-36 items-center justify-center">
      {style.animation === "ping" ? <span aria-hidden="true" className={`absolute ${SHAPE[style.shape]} ${SIZE[style.size]} ${style.colour} animate-ping opacity-40`} /> : null}
      <span aria-hidden="true" className={`relative transition-all duration-200 ${avatarClasses(state)}`} />
    </div>
  );
}
