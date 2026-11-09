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
import { useId } from "react";
import type { AnimationId, AvatarLook, AvatarRendererProps, Eyes, Glow, Posture } from "../../ui/avatar/types";
import { Electricity } from "./Electricity";
import { useFrameTime } from "./frame-time";

/**
 * Curves only, no straight edge, after the concept art's silhouette: a round dome head widest across
 * the bolts, a softly rounded right side tapering in, three hem lobes (small right, large middle, mid left), a
 * soft tuck, then a puffy bulge out to the lower left (a little arm or tail lean) that swells back up
 * into the left side of the head.
 */
export const BODY =
  "M38 86 C38 48 64 24 100 24 C136 24 162 48 162 86 C163 112 160 146 147 170 C141 185 122 198 110 187 C102 202 78 206 72 184 C64 196 42 196 38 174 C22 178 11 166 13 150 C14 134 26 126 34 119 C39 113 38 100 38 86 Z";
/** The hem lobes on their own, for a soft shading line along the bottom. */
export const HEM = "M147 170 C141 185 122 198 110 187 C102 202 78 206 72 184 C64 196 42 196 38 174";

/** Fringe tufts from right to left: the valley where each starts and the tip it hangs to. Uneven on purpose. */
export const HAIR_TUFTS = [
  { valley: { x: 158, y: 54 }, tip: { x: 148, y: 68 } },
  { valley: { x: 140, y: 50 }, tip: { x: 127, y: 65 } },
  { valley: { x: 118, y: 48 }, tip: { x: 104, y: 71 } },
  { valley: { x: 96, y: 50 }, tip: { x: 84, y: 63 } },
  { valley: { x: 76, y: 50 }, tip: { x: 62, y: 67 } },
] as const;
const HAIR_TEMPLE_RIGHT = { x: 167, y: 72 };
const HAIR_TEMPLE_LEFT = { x: 33, y: 72 };
const HAIR_LAST_VALLEY = { x: 50, y: 54 };

/**
 * A cap of hair that hugs the dome a little outside it, hangs slightly over both sides, and ends in a
 * fringe of chunky, uneven, slightly hooked tufts over the forehead. Curves only.
 */
export const HAIR = (() => {
  const top =
    `M${HAIR_TEMPLE_LEFT.x} ${HAIR_TEMPLE_LEFT.y} C27 46 42 26 60 20 C66 13 78 12 86 16 C96 11 114 11 126 16 C150 20 172 40 ` +
    `${HAIR_TEMPLE_RIGHT.x} ${HAIR_TEMPLE_RIGHT.y}`;
  let prev: { x: number; y: number } = HAIR_TEMPLE_RIGHT;
  const segs: string[] = [];
  const up = (from: { x: number; y: number }, v: { x: number; y: number }) => `C${from.x + 1} ${from.y - 8} ${v.x + 4} ${v.y + 1} ${v.x} ${v.y}`;
  const down = (v: { x: number; y: number }, t: { x: number; y: number }) => `C${v.x - 1} ${v.y + 6} ${t.x + 7} ${t.y - 6} ${t.x} ${t.y}`;
  for (const { valley, tip } of HAIR_TUFTS) {
    segs.push(up(prev, valley), down(valley, tip));
    prev = tip;
  }
  segs.push(up(prev, HAIR_LAST_VALLEY), down(HAIR_LAST_VALLEY, HAIR_TEMPLE_LEFT));
  return `${top} ${segs.join(" ")} Z`;
})();
/** Soft sheen strokes across the upper left of the cap, broken like light on hair. */
const HAIR_HIGHLIGHT = "M46 40 C52 30 60 25 70 22 M84 20 C94 16 106 16 116 18";
/** A short strand line into each tuft, so the fringe reads as tufts of hair, not a cut-out. */
const HAIR_STRANDS = HAIR_TUFTS.map(({ tip }) => `M${tip.x + 9} ${tip.y - 16} Q${tip.x + 6} ${tip.y - 7} ${tip.x + 2} ${tip.y - 3}`).join(" ");

/** The specular highlight: a soft tilted oval of light on the upper-left cheek, below the fringe. */
export const SPECULAR = { cx: 50, cy: 100, rx: 12, ry: 22, angle: 14 } as const;
/**
 * Drawn as two arcs rather than an <ellipse> with a rotate(): globals.css gives avatar ellipses and
 * groups `transform-origin: center` on their fill box, which would move a rotate() about a point.
 */
const SPECULAR_PATH = (() => {
  const { cx, cy, rx, ry, angle } = SPECULAR;
  const t = (angle * Math.PI) / 180;
  const dx = -Math.sin(t) * ry;
  const dy = Math.cos(t) * ry;
  const top = `${(cx - dx).toFixed(2)} ${(cy - dy).toFixed(2)}`;
  const bottom = `${(cx + dx).toFixed(2)} ${(cy + dy).toFixed(2)}`;
  return `M${top} A${rx} ${ry} ${angle} 1 0 ${bottom} A${rx} ${ry} ${angle} 1 0 ${top} Z`;
})();

/** The centre of each bolt's outer cap face, where electricity lands. */
const LEFT_BOLT = { x: 24, y: 82 };
const RIGHT_BOLT = { x: 176, y: 82 };
/** The thinking arc's waypoints: up past the left temple, over the hair, down past the right. */
export const ARC_WAYPOINTS = [
  LEFT_BOLT,
  { x: 8, y: 52 },
  { x: 14, y: 14 },
  { x: 46, y: -14 },
  { x: 100, y: -24 },
  { x: 154, y: -14 },
  { x: 186, y: 14 },
  { x: 192, y: 52 },
  RIGHT_BOLT,
] as const;
const ARC_VIA = ARC_WAYPOINTS.slice(1, -1);
/** The wake strikes: from above, around the outside of the head, onto each neck bolt. */
export const STRIKE_WAYPOINTS = [
  [{ x: 44, y: -46 }, { x: 6, y: 36 }, LEFT_BOLT],
  [{ x: 156, y: -46 }, { x: 194, y: 36 }, RIGHT_BOLT],
] as const;
/** Where the short side sparks end, just outside each bolt. */
const SPARK_LEFT_END = { x: 6, y: 68 };
const SPARK_RIGHT_END = { x: 194, y: 68 };
/** Where the fizzle (a failed spark off the right bolt) dies out. */
const FIZZLE_END = { x: 194, y: 72 };

/** The scar: a curved seam at the upper right of the forehead, under the fringe, running toward the right bolt. */
const SCAR = { p0: { x: 116, y: 80 }, p1: { x: 136, y: 72 }, p2: { x: 152, y: 88 } };
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

/**
 * Bolt geometry: a narrow shaft out of the side of the head, then a wider short cylinder (the cap)
 * whose flat round outer face shows as an ellipse at its end.
 */
const BOLT_SHAFT = { length: 13, height: 10 };
const BOLT_HEAD = { length: 7, height: 20 };
const BOLT_FACE = { rx: 3.4, ry: 10 };

/** A darker cap face: brass mixed toward the night (tokens only). */
const BOLT_CAP_FILL = "color-mix(in srgb, var(--color-brass) 62%, var(--color-night-0))";

/** Eye centres and size: tall glossy ovals. */
const EYE_Y = 108;
const EYE_RX = 9.5;
const EYE_LEFT_X = 82;
const EYE_RIGHT_X = 118;

/** Eye ellipse radius-y and offset per Eyes value. */
const EYE_SHAPE: Record<Eyes, { ry: number; dx: number; dy: number; arc?: "closed" | "happy" }> = {
  closed: { ry: 2, dx: 0, dy: 4, arc: "closed" },
  wide: { ry: 19, dx: 0, dy: -2 },
  half: { ry: 8, dx: 0, dy: 4 },
  open: { ry: 16, dx: 0, dy: 0 },
  "glance-up": { ry: 15, dx: 4, dy: -5 },
  squint: { ry: 5, dx: 0, dy: 2 },
  "glance-card": { ry: 15, dx: 7, dy: 0 },
  expectant: { ry: 18, dx: 0, dy: -1 },
  happy: { ry: 6, dx: 0, dy: 0, arc: "happy" },
};

const GLOW_OPACITY: Record<Glow, number> = { dim: 0.12, flare: 0.75, flicker: 0.4, level: 0.22, steady: 0.4, low: 0.2, gold: 0.5 };

/** Posture transforms. Avatar groups transform about their own centre (globals.css), so rotations name no point. */
const POSTURE: Record<Posture, string> = {
  sunk: "translate(0 14)",
  rising: "translate(0 -8)",
  neutral: "",
  lean: "translate(0 -2) scale(1.04)",
  wobble: "rotate(-4)",
  turn: "rotate(5)",
  nod: "translate(0 4)",
};

const has = (look: AvatarLook, id: AnimationId) => look.animations.some((a) => a.id === id);
const animClass = (look: AvatarLook, ...ids: AnimationId[]) => {
  const present = ids.filter((id) => has(look, id));
  return present.length === 0 ? undefined : ["franki-anim", ...present.map((id) => `franki-${id}`)].join(" ");
};

/** The squish presses down onto the hem: scale about the bottom centre of the body's box. */
const SQUISH_ORIGIN = { transformOrigin: "50% 100%" } as const;

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

/** The ids of one ghost's <defs>. Unique per instance, so many ghosts on one page never share a gradient. */
export interface GhostDefIds {
  body: string;
  shade: string;
  specular: string;
  hair: string;
  bolt: string;
  boltGold: string;
  glowGradient: string;
  glow: string;
}

/** Def ids from a React useId value, cleaned of characters that would break `url(#...)`. */
export function ghostDefIds(uid: string): GhostDefIds {
  const tag = uid.replace(/[^A-Za-z0-9_-]/g, "_");
  const id = (name: string) => `franki-${name}-${tag}`;
  return {
    body: id("body"),
    shade: id("shade"),
    specular: id("specular"),
    hair: id("hair"),
    bolt: id("bolt"),
    boltGold: id("bolt-gold"),
    glowGradient: id("glow-gradient"),
    glow: id("glow"),
  };
}

function Eye({ cx, look }: { cx: number; look: AvatarLook }) {
  const s = EYE_SHAPE[look.eyes];
  const x = cx + s.dx;
  const y = EYE_Y + s.dy;
  if (s.arc === "closed") {
    return <path d={`M${x - 11} ${y} Q${x} ${y + 7} ${x + 11} ${y}`} fill="none" stroke="var(--color-night-0)" strokeWidth={4} strokeLinecap="round" />;
  }
  if (s.arc === "happy") {
    return <path d={`M${x - 11} ${y + 4} Q${x} ${y - 12} ${x + 11} ${y + 4}`} fill="none" stroke="var(--color-night-0)" strokeWidth={5} strokeLinecap="round" />;
  }
  const hx = x - 3.2;
  const hy = y - s.ry * 0.5;
  return (
    <>
      <ellipse cx={x} cy={y} rx={EYE_RX} ry={s.ry} fill="var(--color-night-0)" />
      {s.ry > 7 ? <ellipse cx={hx} cy={hy} rx={2.6} ry={Math.min(4.5, s.ry * 0.28)} fill="var(--color-spark)" opacity={0.92} /> : null}
    </>
  );
}

/**
 * A neck bolt: a narrow shaft out of the side of the head, then a wider short cylinder, both shaded
 * brass to brass-hi across their round sides, ending in a darker flat round cap face. `side` is -1 on
 * the left, 1 on the right; (x, y) is the centre of the cap face, where electricity lands.
 */
function Bolt({ x, y, side, part, look, ids }: { x: number; y: number; side: -1 | 1; part: "bolt-left" | "bolt-right"; look: AvatarLook; ids: GhostDefIds }) {
  const dark = look.bolts === "one-dark" && part === "bolt-right";
  const gold = look.bolts === "gold-glow";
  const lit = look.bolts === "glow" || gold;
  const metal = dark ? "var(--color-stitch)" : gold ? `url(#${ids.boltGold})` : `url(#${ids.bolt})`;
  const cap = dark ? "var(--color-night-2)" : gold ? "var(--color-gold)" : BOLT_CAP_FILL;
  const rim = dark ? "var(--color-stitch)" : "var(--color-brass-hi)";
  // Both pieces run from the cap face inward, toward the head.
  const headX = side === -1 ? x : x - BOLT_HEAD.length;
  const shaftX = side === -1 ? x + BOLT_HEAD.length - 1 : x - BOLT_HEAD.length - BOLT_SHAFT.length + 1;
  const innerX = x - side * BOLT_HEAD.length;
  return (
    <g data-part={part}>
      {lit ? <circle cx={x - side * 5} cy={y} r={14} fill={gold ? "var(--color-gold)" : "var(--color-brass-hi)"} opacity={0.35} /> : null}
      <rect data-part="bolt-shaft" x={shaftX} y={y - BOLT_SHAFT.height / 2} width={BOLT_SHAFT.length} height={BOLT_SHAFT.height} rx={1.5} fill={metal} />
      <rect x={headX} y={y - BOLT_HEAD.height / 2} width={BOLT_HEAD.length} height={BOLT_HEAD.height} rx={2} fill={metal} />
      {/* The inner rim of the cylinder, a thin dark line where it meets the shaft. */}
      <line x1={innerX} y1={y - BOLT_HEAD.height / 2 + 1.5} x2={innerX} y2={y + BOLT_HEAD.height / 2 - 1.5} stroke="var(--color-night-0)" strokeOpacity={dark ? 0 : 0.25} strokeWidth={1} />
      <ellipse data-part="bolt-cap" cx={x} cy={y} rx={BOLT_FACE.rx} ry={BOLT_FACE.ry} fill={cap} stroke={rim} strokeOpacity={0.75} strokeWidth={1.2} />
      <ellipse cx={x - side * 0.6} cy={y - 4.5} rx={1.1} ry={3} fill="var(--color-brass-hi)" opacity={dark ? 0 : 0.65} />
    </g>
  );
}

function Bolts({ look, input }: AvatarRendererProps) {
  const frameTime = useFrameTime();
  const reduced = input.reducedMotion;
  switch (look.bolts) {
    case "arc":
      // The thinking arc crosses over the top of the head, from bolt to bolt, clear of the hair.
      return <Electricity a={LEFT_BOLT} b={RIGHT_BOLT} via={ARC_VIA} frameTime={frameTime} reduced={reduced} seed={11} />;
    case "strike":
      // The wake strike comes down from above onto both neck bolts at once, outside the face.
      return (
        <g className={animClass(look, "strike")}>
          {STRIKE_WAYPOINTS.map(([a, mid, b], i) => (
            <Electricity key={i} a={a} b={b} via={[mid]} frameTime={frameTime} reduced={reduced} seed={21 + i} />
          ))}
        </g>
      );
    case "fizzle":
      return (
        <g className={animClass(look, "fizzle")}>
          <Electricity a={RIGHT_BOLT} b={FIZZLE_END} frameTime={frameTime} reduced={reduced} seed={31} depth={3} />
        </g>
      );
    case "sparks":
      return (
        <g className={animClass(look, "sparks")}>
          <Electricity a={LEFT_BOLT} b={SPARK_LEFT_END} frameTime={frameTime} reduced={reduced} seed={41} depth={3} />
          <Electricity a={RIGHT_BOLT} b={SPARK_RIGHT_END} frameTime={frameTime} reduced={reduced} seed={42} depth={3} />
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
  const ids = ghostDefIds(useId());
  const { sx, sy } = squishScale(look);
  const glow = glowOpacity(look);
  const glowColour = look.glow === "gold" ? "var(--color-gold)" : "var(--color-ecto)";
  return (
    <svg viewBox="0 0 200 220" overflow="visible" className="franki-ghost block h-auto w-full" aria-hidden="true" focusable="false" data-renderer="svg-ghost">
      <defs>
        {/* A soft vertical gradient, ghost at the head to ghost-deep at the hem. */}
        <linearGradient id={ids.body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-ghost)" />
          <stop offset="50%" stopColor="var(--color-ghost)" />
          <stop offset="100%" stopColor="var(--color-ghost-deep)" />
        </linearGradient>
        {/* Soft inner shading: clear in the lit upper left, deepening toward every edge, so the body reads puffy. */}
        <radialGradient id={ids.shade} cx="40%" cy="36%" r="68%" fx="34%" fy="30%">
          <stop offset="0%" stopColor="var(--color-ghost-deep)" stopOpacity={0} />
          <stop offset="62%" stopColor="var(--color-ghost-deep)" stopOpacity={0} />
          <stop offset="100%" stopColor="var(--color-ghost-deep)" stopOpacity={0.7} />
        </radialGradient>
        <radialGradient id={ids.specular} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-spark)" stopOpacity={0.6} />
          <stop offset="50%" stopColor="var(--color-spark)" stopOpacity={0.22} />
          <stop offset="100%" stopColor="var(--color-spark)" stopOpacity={0} />
        </radialGradient>
        {/* Dark hair with a soft sheen at the upper left. */}
        <radialGradient id={ids.hair} cx="34%" cy="16%" r="70%">
          <stop offset="0%" stopColor="var(--color-stitch)" />
          <stop offset="45%" stopColor="var(--color-night-2)" />
          <stop offset="100%" stopColor="var(--color-night-1)" />
        </radialGradient>
        {/* A cylinder lit from above: brass at the edges, brass-hi across the upper middle. */}
        <linearGradient id={ids.bolt} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brass)" />
          <stop offset="32%" stopColor="var(--color-brass-hi)" />
          <stop offset="100%" stopColor="var(--color-brass)" />
        </linearGradient>
        <linearGradient id={ids.boltGold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-gold)" />
          <stop offset="32%" stopColor="var(--color-spark)" />
          <stop offset="100%" stopColor="var(--color-gold)" />
        </linearGradient>
        <radialGradient id={ids.glowGradient}>
          <stop offset="0%" stopColor={glowColour} stopOpacity={1} />
          <stop offset="100%" stopColor={glowColour} stopOpacity={0} />
        </radialGradient>
        {look.blur ? (
          <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={10} />
          </filter>
        ) : null}
      </defs>
      <g className={animClass(look, "float", "fade")}>
        <g transform={POSTURE[look.posture] || undefined} data-posture={look.posture} className={animClass(look, "rise", "wobble", "nod")}>
          <ellipse
            data-part="glow"
            cx={96}
            cy={112}
            rx={90}
            ry={94}
            fill={look.blur ? glowColour : `url(#${ids.glowGradient})`}
            filter={look.blur ? `url(#${ids.glow})` : undefined}
            opacity={glow}
            className={animClass(look, "flicker")}
          />
          <g data-part="body-group" opacity={look.bodyOpacity} data-squish={sy.toFixed(3)} transform={sx === 1 && sy === 1 ? undefined : `scale(${sx.toFixed(3)} ${sy.toFixed(3)})`} style={SQUISH_ORIGIN}>
            <g className={animClass(look, "breathe")}>
              {/* Bolts first, so the head overlaps the inner end of each shaft. */}
              <Bolt x={LEFT_BOLT.x} y={LEFT_BOLT.y} side={-1} part="bolt-left" look={look} ids={ids} />
              <Bolt x={RIGHT_BOLT.x} y={RIGHT_BOLT.y} side={1} part="bolt-right" look={look} ids={ids} />
              <path data-part="body" d={BODY} fill={`url(#${ids.body})`} />
              <path data-part="shade" d={BODY} fill={`url(#${ids.shade})`} />
              {/* A faint ecto rim light along the edge: a wide soft stroke under a thin one. No filter. */}
              <g data-part="rim" fill="none" stroke="var(--color-ecto)" strokeLinejoin="round">
                <path d={BODY} strokeOpacity={0.1} strokeWidth={6} />
                <path d={BODY} strokeOpacity={0.3} strokeWidth={1.5} />
              </g>
              <path data-part="hem" d={HEM} fill="none" stroke="var(--color-ghost-deep)" strokeOpacity={0.7} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              <path data-part="specular" d={SPECULAR_PATH} fill={`url(#${ids.specular})`} />
              <path data-part="hair" d={HAIR} fill={`url(#${ids.hair})`} stroke="var(--color-ecto)" strokeOpacity={0.14} strokeWidth={1.2} strokeLinejoin="round" />
              <path data-part="hair-strands" d={HAIR_STRANDS} fill="none" stroke="var(--color-night-0)" strokeOpacity={0.5} strokeWidth={1.4} strokeLinecap="round" />
              <path data-part="hair-highlight" d={HAIR_HIGHLIGHT} fill="none" stroke="var(--color-ink-dim)" strokeOpacity={0.11} strokeWidth={4} strokeLinecap="round" />
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
              <Eye cx={EYE_LEFT_X} look={look} />
            </g>
            <g data-part="eye-right">
              <Eye cx={EYE_RIGHT_X} look={look} />
            </g>
          </g>
          <Bolts look={look} input={input} />
        </g>
      </g>
    </svg>
  );
}
