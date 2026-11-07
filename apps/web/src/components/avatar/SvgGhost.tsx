"use client";
// The SVG_Ghost renderer (lab-ui-foundation R4.1, R4.3 to R4.5, R6.13, R7.3, R7.4, R9.1, R9.3). Drawn
// in SVG in code: a soft-green glossy body wider at the top with a wavy three-lobe hem, flat-top dark
// hair with a ragged fringe, two brass neck bolts, a short stitched scar at the upper right of the
// forehead, and two big glossy black oval eyes with a highlight. No mouth. Implements the
// Avatar_Contract; the look decides everything, this file only draws it.
import type { AnimationId, AvatarLook, AvatarRendererProps, Eyes, Glow, Posture } from "../../ui/avatar/types";
import { Electricity } from "./Electricity";
import { useFrameTime } from "./frame-time";

const BODY =
  "M36 96 C36 34 164 34 164 96 C164 128 157 156 152 170 Q140 196 126 176 Q113 158 100 182 Q87 158 74 176 Q60 196 48 170 C43 156 36 128 36 96 Z";
const HEM = "M48 170 Q60 196 74 176 Q87 158 100 182 Q113 158 126 176 Q140 196 152 170";
const HAIR =
  "M50 64 L50 48 Q50 40 60 40 L140 40 Q150 40 150 48 L150 64 L143 71 L137 62 L129 73 L121 63 L113 72 L105 62 L97 73 L89 63 L81 72 L73 62 L65 71 L58 63 Z";

const LEFT_BOLT = { x: 22, y: 96 };
const RIGHT_BOLT = { x: 178, y: 96 };

/** Eye ellipse radius-y and offset per Eyes value. */
const EYE_SHAPE: Record<Eyes, { ry: number; dx: number; dy: number; arc?: "closed" | "happy" }> = {
  closed: { ry: 2, dx: 0, dy: 4, arc: "closed" },
  wide: { ry: 21, dx: 0, dy: -2 },
  half: { ry: 9, dx: 0, dy: 4 },
  open: { ry: 17, dx: 0, dy: 0 },
  "glance-up": { ry: 16, dx: 5, dy: -5 },
  squint: { ry: 6, dx: 0, dy: 2 },
  "glance-card": { ry: 16, dx: 8, dy: 0 },
  expectant: { ry: 19, dx: 0, dy: -1 },
  happy: { ry: 6, dx: 0, dy: 0, arc: "happy" },
};

const GLOW_OPACITY: Record<Glow, number> = { dim: 0.12, flare: 0.75, flicker: 0.4, level: 0.22, steady: 0.4, low: 0.2, gold: 0.5 };

const POSTURE: Record<Posture, string> = {
  sunk: "translate(0 14)",
  rising: "translate(0 -8)",
  neutral: "",
  lean: "translate(0 -2) scale(1.04)",
  wobble: "rotate(-4 100 120)",
  turn: "rotate(5 100 120)",
  nod: "translate(0 4)",
};

const has = (look: AvatarLook, id: AnimationId) => look.animations.some((a) => a.id === id);
const animClass = (look: AvatarLook, ...ids: AnimationId[]) => {
  const present = ids.filter((id) => has(look, id));
  return present.length === 0 ? undefined : ["franki-anim", ...present.map((id) => `franki-${id}`)].join(" ");
};

/** Body squish scale from the followed output level (R7.3, R7.4): exactly 1 unless Speaking audibly. */
export function squishScale(look: AvatarLook): { sx: number; sy: number } {
  if (look.body !== "squish" || look.follows !== "output") return { sx: 1, sy: 1 };
  return { sx: 1 + 0.06 * look.drive, sy: 1 - 0.08 * look.drive };
}

function glowOpacity(look: AvatarLook): number {
  const base = GLOW_OPACITY[look.glow];
  // A glow that follows a level: the mic while listening, or the voice in reduced motion (opacity only).
  return look.follows === "none" ? base : Math.min(0.9, base + 0.5 * look.drive);
}

function Eye({ cx, look }: { cx: number; look: AvatarLook }) {
  const s = EYE_SHAPE[look.eyes];
  const x = cx + s.dx;
  const y = 112 + s.dy;
  if (s.arc === "closed") {
    return <path d={`M${x - 13} ${y} Q${x} ${y + 7} ${x + 13} ${y}`} fill="none" stroke="var(--color-night-0)" strokeWidth={4} strokeLinecap="round" />;
  }
  if (s.arc === "happy") {
    return <path d={`M${x - 13} ${y + 4} Q${x} ${y - 12} ${x + 13} ${y + 4}`} fill="none" stroke="var(--color-night-0)" strokeWidth={5} strokeLinecap="round" />;
  }
  return (
    <>
      <ellipse cx={x} cy={y} rx={14} ry={s.ry} fill="var(--color-night-0)" />
      {s.ry > 8 ? <ellipse cx={x + 5} cy={y - s.ry * 0.45} rx={4} ry={Math.min(5, s.ry * 0.3)} fill="var(--color-spark)" opacity={0.9} /> : null}
    </>
  );
}

function Bolt({ x, y, part, look }: { x: number; y: number; part: "bolt-left" | "bolt-right"; look: AvatarLook }) {
  const dark = look.bolts === "one-dark" && part === "bolt-right";
  const fill = dark ? "var(--color-stitch)" : look.bolts === "gold-glow" ? "var(--color-gold)" : "var(--color-brass)";
  const lit = look.bolts === "glow" || look.bolts === "gold-glow";
  return (
    <g data-part={part}>
      {lit ? <circle cx={x} cy={y} r={11} fill={look.bolts === "gold-glow" ? "var(--color-gold)" : "var(--color-brass-hi)"} opacity={0.35} /> : null}
      <rect x={x - 6} y={y - 7} width={12} height={14} rx={2} fill={fill} />
      <rect x={x - 8} y={y - 3} width={16} height={6} rx={2} fill={dark ? "var(--color-night-2)" : "var(--color-brass-hi)"} />
    </g>
  );
}

function Bolts({ look, input }: AvatarRendererProps) {
  const frameTime = useFrameTime();
  const reduced = input.reducedMotion;
  switch (look.bolts) {
    case "arc":
      return <Electricity a={LEFT_BOLT} b={RIGHT_BOLT} frameTime={frameTime} reduced={reduced} seed={11} />;
    case "strike":
      return (
        <g className={animClass(look, "strike")}>
          <Electricity a={{ x: 30, y: 0 }} b={LEFT_BOLT} frameTime={frameTime} reduced={reduced} seed={21} />
          <Electricity a={{ x: 170, y: 0 }} b={RIGHT_BOLT} frameTime={frameTime} reduced={reduced} seed={22} />
        </g>
      );
    case "fizzle":
      return (
        <g className={animClass(look, "fizzle")}>
          <Electricity a={RIGHT_BOLT} b={{ x: 192, y: 80 }} frameTime={frameTime} reduced={reduced} seed={31} depth={3} />
        </g>
      );
    case "sparks":
      return (
        <g className={animClass(look, "sparks")}>
          <Electricity a={LEFT_BOLT} b={{ x: 6, y: 74 }} frameTime={frameTime} reduced={reduced} seed={41} depth={3} />
          <Electricity a={RIGHT_BOLT} b={{ x: 194, y: 74 }} frameTime={frameTime} reduced={reduced} seed={42} depth={3} />
        </g>
      );
    case "flicker":
      return (
        <g className={animClass(look, "flicker")} aria-hidden="true">
          <circle cx={LEFT_BOLT.x} cy={LEFT_BOLT.y} r={10} fill="var(--color-spark)" opacity={0.4} />
          <circle cx={RIGHT_BOLT.x} cy={RIGHT_BOLT.y} r={10} fill="var(--color-spark)" opacity={0.4} />
        </g>
      );
    default:
      return null;
  }
}

export function SvgGhost({ look, input }: AvatarRendererProps) {
  const { sx, sy } = squishScale(look);
  const glow = glowOpacity(look);
  const glowColour = look.glow === "gold" ? "var(--color-gold)" : "var(--color-ecto)";
  return (
    <svg viewBox="0 0 200 220" className="franki-ghost block h-auto w-full" aria-hidden="true" focusable="false" data-renderer="svg-ghost">
      <defs>
        <radialGradient id="franki-body" cx="40%" cy="30%" r="75%">
          <stop offset="0%" stopColor="var(--color-ghost)" />
          <stop offset="70%" stopColor="var(--color-ghost)" />
          <stop offset="100%" stopColor="var(--color-ghost-deep)" />
        </radialGradient>
        <radialGradient id="franki-glow-gradient">
          <stop offset="0%" stopColor={glowColour} stopOpacity={1} />
          <stop offset="100%" stopColor={glowColour} stopOpacity={0} />
        </radialGradient>
        {look.blur ? (
          <filter id="franki-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={10} />
          </filter>
        ) : null}
      </defs>
      <g className={animClass(look, "float", "fade")}>
        <g transform={POSTURE[look.posture] || undefined} data-posture={look.posture} className={animClass(look, "rise", "wobble", "nod")}>
          <ellipse
            data-part="glow"
            cx={100}
            cy={112}
            rx={86}
            ry={92}
            fill={look.blur ? glowColour : "url(#franki-glow-gradient)"}
            filter={look.blur ? "url(#franki-glow)" : undefined}
            opacity={glow}
            className={animClass(look, "flicker")}
          />
          <g data-part="body-group" opacity={look.bodyOpacity} data-squish={sy.toFixed(3)} transform={sx === 1 && sy === 1 ? undefined : `translate(100 182) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-100 -182)`}>
            <g className={animClass(look, "breathe")}>
              <path data-part="body" d={BODY} fill="url(#franki-body)" />
              <path d="M58 66 Q70 52 88 50" fill="none" stroke="var(--color-spark)" strokeOpacity={0.55} strokeWidth={5} strokeLinecap="round" />
              <path data-part="hem" d={HEM} fill="none" stroke="var(--color-ghost-deep)" strokeWidth={3} strokeLinejoin="round" />
              <path data-part="hair" d={HAIR} fill="var(--color-night-1)" />
              <g data-part="scar" stroke="var(--color-stitch)" strokeWidth={2} strokeLinecap="round">
                <line x1={116} y1={84} x2={138} y2={78} />
                <line x1={120} y1={79} x2={122} y2={87} />
                <line x1={127} y1={77} x2={129} y2={85} />
                <line x1={134} y1={75} x2={136} y2={83} />
              </g>
              <Bolt x={LEFT_BOLT.x} y={LEFT_BOLT.y} part="bolt-left" look={look} />
              <Bolt x={RIGHT_BOLT.x} y={RIGHT_BOLT.y} part="bolt-right" look={look} />
            </g>
          </g>
          <g data-part="eyes" opacity={look.eyeOpacity} className={animClass(look, "blink", "glance")}>
            <g data-part="eye-left">
              <Eye cx={78} look={look} />
            </g>
            <g data-part="eye-right">
              <Eye cx={122} look={look} />
            </g>
          </g>
          <Bolts look={look} input={input} />
        </g>
      </g>
    </svg>
  );
}
