"use client";
// The SVG_Ghost renderer (lab-ui-foundation R4.1, R4.3 to R4.5, R6.13, R7.3, R7.4, R9.1, R9.3). Drawn
// in SVG in code: a soft-green glossy body wider at the top with a wavy three-lobe hem, flat-top dark
// hair with a ragged fringe, two brass neck bolts, a short stitched scar at the upper right of the
// forehead, and two big glossy black oval eyes with a highlight. No mouth. Implements the
// Avatar_Contract; the look decides everything, this file only draws it.
// Brief 004 item 4 redraw, after the concept art's proportions and shading: one smooth closed body
// path of curves only (a dome widest across the head, a gentle uneven taper, three unequal hem
// lobes), a vertical ghost to ghost-deep gradient with a faint ecto rim and one specular highlight,
// hair with a flat top and a fringe of uneven tufts, cylinder bolts, and a curved stitched scar. The
// drawing is the same under Reduced_Motion; only motion changes. Tokens only.
import type { AnimationId, AvatarLook, AvatarRendererProps, Eyes, Glow, Posture } from "../../ui/avatar/types";
import { Electricity } from "./Electricity";
import { useFrameTime } from "./frame-time";

/** Curves only, no straight edge: dome, right side, three hem lobes (small, middle, large), left side. */
export const BODY =
  "M36 92 C36 48 66 28 102 28 C140 28 168 50 166 92 C165 122 156 146 146 160 C148 176 134 184 124 174 C116 190 96 194 88 180 C78 196 44 204 34 184 C26 166 34 128 36 92 Z";
/** The hem lobes on their own, for a soft shading line along the bottom. */
export const HEM = "M146 160 C148 176 134 184 124 174 C116 190 96 194 88 180 C78 196 44 204 34 184";

/** Fringe tufts from right to left: the valley where each starts and the tip it hangs to. Uneven on purpose. */
export const HAIR_TUFTS = [
  { valley: { x: 152, y: 52 }, tip: { x: 144, y: 70 } },
  { valley: { x: 134, y: 52 }, tip: { x: 123, y: 74 } },
  { valley: { x: 112, y: 54 }, tip: { x: 100, y: 81 } },
  { valley: { x: 90, y: 54 }, tip: { x: 79, y: 72 } },
  { valley: { x: 68, y: 52 }, tip: { x: 56, y: 77 } },
] as const;
const HAIR_TEMPLE_RIGHT = { x: 164, y: 66 };
const HAIR_TEMPLE_LEFT = { x: 40, y: 66 };
const HAIR_LAST_VALLEY = { x: 50, y: 56 };

/** A flat top with volume and a ragged fringe of uneven, slightly hooked tufts. Curves only. */
export const HAIR = (() => {
  const top =
    `M${HAIR_TEMPLE_LEFT.x} ${HAIR_TEMPLE_LEFT.y} C34 48 44 30 62 24 C80 18 96 22 108 19 C128 16 150 20 160 30 ` +
    `C170 40 170 54 ${HAIR_TEMPLE_RIGHT.x} ${HAIR_TEMPLE_RIGHT.y}`;
  let prev: { x: number; y: number } = HAIR_TEMPLE_RIGHT;
  const segs: string[] = [];
  const up = (from: { x: number; y: number }, v: { x: number; y: number }) => `C${from.x - 2} ${from.y - 7} ${v.x + 3} ${v.y + 2} ${v.x} ${v.y}`;
  const down = (v: { x: number; y: number }, t: { x: number; y: number }) => `C${v.x - 2} ${v.y + 5} ${t.x + 5} ${t.y - 7} ${t.x} ${t.y}`;
  for (const { valley, tip } of HAIR_TUFTS) {
    segs.push(up(prev, valley), down(valley, tip));
    prev = tip;
  }
  segs.push(up(prev, HAIR_LAST_VALLEY), down(HAIR_LAST_VALLEY, HAIR_TEMPLE_LEFT));
  return `${top} ${segs.join(" ")} Z`;
})();
const HAIR_HIGHLIGHT = "M66 30 C84 23 104 26 126 22";

const LEFT_BOLT = { x: 23, y: 90 };
const RIGHT_BOLT = { x: 177, y: 90 };

/** The scar: a short curved seam at the upper right of the forehead. */
const SCAR = { p0: { x: 114, y: 84 }, p1: { x: 132, y: 80 }, p2: { x: 148, y: 93 } };
const SCAR_PATH = `M${SCAR.p0.x} ${SCAR.p0.y} Q${SCAR.p1.x} ${SCAR.p1.y} ${SCAR.p2.x} ${SCAR.p2.y}`;

/** Crossing stitches at even steps along the seam, each perpendicular to it. */
export const SCAR_STITCHES = [0.2, 0.45, 0.7, 0.92].map((t) => {
  const { p0, p1, p2 } = SCAR;
  const u = 1 - t;
  const x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
  const y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
  const tx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const ty = 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
  const len = Math.hypot(tx, ty);
  const half = 4.5;
  const nx = (-ty / len) * half;
  const ny = (tx / len) * half;
  return { x1: x - nx, y1: y - ny, x2: x + nx, y2: y + ny };
});

/** Bolt geometry: a shaft out from the side of the head and a cap at its outer end. */
const BOLT_SHAFT = { length: 16, height: 14 };
const BOLT_CAP = { rx: 5, ry: 11 };

/** A darker cap: brass mixed toward the night (tokens only). */
const BOLT_CAP_FILL = "color-mix(in srgb, var(--color-brass) 62%, var(--color-night-0))";

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

/**
 * A neck bolt: a short horizontal cylinder (a shaft shaded brass to brass-hi across its round side)
 * coming out of the side of the head, with a darker cap disc at its outer end. `side` is -1 on the
 * left, 1 on the right; (x, y) is the cap centre, where electricity lands.
 */
function Bolt({ x, y, side, part, look }: { x: number; y: number; side: -1 | 1; part: "bolt-left" | "bolt-right"; look: AvatarLook }) {
  const dark = look.bolts === "one-dark" && part === "bolt-right";
  const gold = look.bolts === "gold-glow";
  const lit = look.bolts === "glow" || gold;
  const shaft = dark ? "var(--color-stitch)" : gold ? "url(#franki-bolt-gold)" : "url(#franki-bolt)";
  const cap = dark ? "var(--color-night-2)" : gold ? "var(--color-gold)" : BOLT_CAP_FILL;
  const rim = dark ? "var(--color-stitch)" : "var(--color-brass-hi)";
  const { length, height } = BOLT_SHAFT;
  // The shaft runs from the cap inward, toward the head.
  const shaftX = side === -1 ? x : x - length;
  return (
    <g data-part={part}>
      {lit ? <circle cx={x - side * 4} cy={y} r={13} fill={gold ? "var(--color-gold)" : "var(--color-brass-hi)"} opacity={0.35} /> : null}
      <rect data-part="bolt-shaft" x={shaftX} y={y - height / 2} width={length} height={height} rx={2.5} fill={shaft} />
      <ellipse data-part="bolt-cap" cx={x} cy={y} rx={BOLT_CAP.rx} ry={BOLT_CAP.ry} fill={cap} stroke={rim} strokeOpacity={0.7} strokeWidth={1.2} />
      <ellipse cx={x - side * 0.8} cy={y - 4} rx={1.4} ry={3} fill="var(--color-brass-hi)" opacity={dark ? 0 : 0.6} />
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
        {/* A soft vertical gradient, ghost at the head to ghost-deep at the hem. */}
        <linearGradient id="franki-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-ghost)" />
          <stop offset="45%" stopColor="var(--color-ghost)" />
          <stop offset="100%" stopColor="var(--color-ghost-deep)" />
        </linearGradient>
        <radialGradient id="franki-specular" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-spark)" stopOpacity={0.9} />
          <stop offset="100%" stopColor="var(--color-spark)" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="franki-hair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-night-2)" />
          <stop offset="100%" stopColor="var(--color-night-1)" />
        </linearGradient>
        {/* A cylinder lit from above: brass at the edges, brass-hi across the upper middle. */}
        <linearGradient id="franki-bolt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brass)" />
          <stop offset="35%" stopColor="var(--color-brass-hi)" />
          <stop offset="100%" stopColor="var(--color-brass)" />
        </linearGradient>
        <linearGradient id="franki-bolt-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-gold)" />
          <stop offset="35%" stopColor="var(--color-spark)" />
          <stop offset="100%" stopColor="var(--color-gold)" />
        </linearGradient>
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
          <g data-part="body-group" opacity={look.bodyOpacity} data-squish={sy.toFixed(3)} transform={sx === 1 && sy === 1 ? undefined : `translate(100 196) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-100 -196)`}>
            <g className={animClass(look, "breathe")}>
              {/* Bolts first, so the head overlaps the inner end of each shaft. */}
              <Bolt x={LEFT_BOLT.x} y={LEFT_BOLT.y} side={-1} part="bolt-left" look={look} />
              <Bolt x={RIGHT_BOLT.x} y={RIGHT_BOLT.y} side={1} part="bolt-right" look={look} />
              <path data-part="body" d={BODY} fill="url(#franki-body)" />
              {/* A faint ecto rim light along the edge: a wide soft stroke under a thin one. No filter. */}
              <g data-part="rim" fill="none" stroke="var(--color-ecto)" strokeLinejoin="round">
                <path d={BODY} strokeOpacity={0.1} strokeWidth={6} />
                <path d={BODY} strokeOpacity={0.3} strokeWidth={1.5} />
              </g>
              <path data-part="hem" d={HEM} fill="none" stroke="var(--color-ghost-deep)" strokeOpacity={0.7} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              <ellipse data-part="specular" cx={50} cy={92} rx={7} ry={15} transform="rotate(14 50 92)" fill="url(#franki-specular)" />
              <path data-part="hair" d={HAIR} fill="url(#franki-hair)" stroke="var(--color-ecto)" strokeOpacity={0.14} strokeWidth={1.2} strokeLinejoin="round" />
              <path data-part="hair-highlight" d={HAIR_HIGHLIGHT} fill="none" stroke="var(--color-ink-dim)" strokeOpacity={0.22} strokeWidth={3} strokeLinecap="round" />
              <g data-part="scar" fill="none" stroke="var(--color-stitch)" strokeLinecap="round">
                <path data-part="scar-seam" d={SCAR_PATH} strokeWidth={2} />
                {SCAR_STITCHES.map((s, i) => (
                  <line key={i} data-part="stitch" x1={s.x1.toFixed(2)} y1={s.y1.toFixed(2)} x2={s.x2.toFixed(2)} y2={s.y2.toFixed(2)} strokeWidth={1.8} />
                ))}
              </g>
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
