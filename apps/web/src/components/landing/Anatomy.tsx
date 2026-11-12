"use client";
// The anatomy of the build: a blueprint of Franki from the front (the body outline with its three-lobe hem,
// the flat-top hair, two neck bolts, the stitched scar, the eyes, the centre line) with four callouts on
// leader lines. Skeleton points at the centre line, Brain at the head, Reflexes at the bolts, Immune system
// at the body's edge. As a callout enters view its leader draws and its part of the drawing turns from
// stitch to ecto linework (lower.css). From a 58rem container the callouts stand either side of the drawing
// with their leaders running straight to it; below that the drawing sits above them, each part carries a
// lettered marker that matches its callout, and all four parts light in copy order as the drawing itself
// enters view.
import type { CSSProperties, ReactNode } from "react";
import { LANDING } from "../../ui/copy-landing";
import { BODY, HAIR, HEM } from "../avatar/SvgGhost";
import { FigLabel } from "../lab/FigLabel";
import { useSeen } from "./use-seen";

export type PartId = (typeof LANDING.build.parts)[number]["id"];

/** The callouts' fig letters, in copy order. */
const LETTERS = ["A", "B", "C", "D"] as const;

/** The drawing's viewBox, in the SVG ghost's own coordinates (its 200 by 220 box), with room for the markers. */
export const VIEW = { x: -20, y: -10, width: 240, height: 250 } as const;

/**
 * The wide layout: a 1000 by 560 figure. The drawing fills 48% of its width from 26%, at two figure units per
 * ghost unit, 30 units down; the callouts take the 26% either side.
 */
export const FIGURE = { width: 1000, height: 560, drawLeft: 260, drawTop: 30, scale: 2 } as const;

interface Pt {
  x: number;
  y: number;
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** The neck bolts: a shaft out of the head, a wider cap, and the cap's round outer face. */
const BOLT = { y: 82, shaftHalf: 5, capHalf: 10, faceRx: 3.4 } as const;
const LEFT_BOLT = { shaft: [27, 38], cap: [20, 27], face: 20 } as const;
const RIGHT_BOLT = { shaft: [162, 173], cap: [173, 180], face: 180 } as const;

/** The scar at the upper right of the forehead, and its crossing stitches. */
const SCAR = { p0: { x: 116, y: 80 }, p1: { x: 136, y: 72 }, p2: { x: 152, y: 88 } } as const;
const SCAR_STITCHES = [0.2, 0.45, 0.7, 0.92].map((t) => {
  const { p0, p1, p2 } = SCAR;
  const u = 1 - t;
  const x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
  const y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
  const tx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const ty = 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
  const len = Math.hypot(tx, ty);
  return `M${(x + (ty / len) * 4.5).toFixed(2)} ${(y - (tx / len) * 4.5).toFixed(2)}L${(x - (ty / len) * 4.5).toFixed(2)} ${(y + (tx / len) * 4.5).toFixed(2)}`;
}).join("");

/** Where each leader ends on the drawing, in ghost coordinates, and which side its callout stands on. */
export const TARGETS: Record<PartId, { at: Pt; side: "left" | "right" }> = {
  // On the centre line, at the height of the lower body.
  skeleton: { at: { x: 100, y: 158 }, side: "left" },
  // On the outline of the hair, a third of the way up its left side.
  brain: { at: cubic({ x: 33, y: 72 }, { x: 27, y: 46 }, { x: 42, y: 26 }, { x: 60, y: 20 }, 0.35), side: "left" },
  // On the face of the right bolt.
  reflexes: { at: { x: RIGHT_BOLT.face + BOLT.faceRx, y: BOLT.y }, side: "right" },
  // On the body's right edge, just above the hem.
  immune: { at: cubic({ x: 162, y: 86 }, { x: 163, y: 112 }, { x: 160, y: 146 }, { x: 147, y: 170 }, 0.9), side: "right" },
};

/** A leader's height in the wide figure, as a percentage of the figure's height. */
export function leaderTop(id: PartId): number {
  const y = FIGURE.drawTop + FIGURE.scale * (TARGETS[id].at.y - VIEW.y);
  return (y / FIGURE.height) * 100;
}

function pct(n: number): string {
  return `${Number(n.toFixed(3))}%`;
}

/** The wide-layout box of the drawing inside the figure, as percentages. */
const DRAW_BOX = {
  left: pct((FIGURE.drawLeft / FIGURE.width) * 100),
  top: pct((FIGURE.drawTop / FIGURE.height) * 100),
  width: pct(((VIEW.width * FIGURE.scale) / FIGURE.width) * 100),
};
const SIDE_WIDTH = DRAW_BOX.left;

function bolt(b: typeof LEFT_BOLT | typeof RIGHT_BOLT, outward: 1 | -1): ReactNode {
  const [s0, s1] = b.shaft;
  const [c0, c1] = b.cap;
  return (
    <>
      <path d={`M${s0} ${BOLT.y - BOLT.shaftHalf}H${s1}M${s0} ${BOLT.y + BOLT.shaftHalf}H${s1}`} />
      <rect x={c0} y={BOLT.y - BOLT.capHalf} width={c1 - c0} height={BOLT.capHalf * 2} rx={2} />
      <ellipse cx={b.face} cy={BOLT.y} rx={BOLT.faceRx} ry={BOLT.capHalf} />
      <path d={`M${b.face + outward * 0.6} ${BOLT.y - 5}v10`} strokeDasharray="1.5 2" />
    </>
  );
}

/** Each part of the drawing, as linework. */
const SHAPES: Record<PartId, ReactNode> = {
  skeleton: (
    <>
      <path d="M100 -4V236" strokeDasharray="7 3 1.5 3" />
      <path d="M95 24H105M95 206H105M95 82H105" />
    </>
  ),
  brain: (
    <>
      <circle cx={100} cy={86} r={62} strokeDasharray="3 4" />
      <path d={HAIR} />
      <ellipse cx={82} cy={108} rx={9.5} ry={16} />
      <ellipse cx={118} cy={108} rx={9.5} ry={16} />
      <ellipse cx={79} cy={101} rx={2.4} ry={4} />
      <ellipse cx={115} cy={101} rx={2.4} ry={4} />
    </>
  ),
  reflexes: (
    <>
      {bolt(LEFT_BOLT, -1)}
      {bolt(RIGHT_BOLT, 1)}
    </>
  ),
  immune: (
    <>
      <path d={BODY} />
      <path d={HEM} transform="translate(0 -5)" strokeDasharray="2 3" />
      <path d={`M${SCAR.p0.x} ${SCAR.p0.y}Q${SCAR.p1.x} ${SCAR.p1.y} ${SCAR.p2.x} ${SCAR.p2.y}`} />
      <path d={SCAR_STITCHES} />
    </>
  ),
};

/** The order parts are drawn in: the body first, the hair over it, the centre line on top. */
const DRAW_ORDER: readonly PartId[] = ["immune", "reflexes", "brain", "skeleton"];

/** A part's place in copy order, for the stacked layout, where all four light in turn (lower.css). */
const order = (id: PartId): CSSProperties => ({ "--n": LANDING.build.parts.findIndex((p) => p.id === id) }) as CSSProperties;

function Drawing({ lit }: { lit: (id: PartId) => boolean }) {
  const parts = LANDING.build.parts;
  return (
    <svg
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
      aria-hidden="true"
      focusable="false"
      data-anatomy-drawing=""
      className="anatomy-drawing pointer-events-none block h-auto w-full"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Unlit construction: the floor under Franki and the head's width. Never lit. */}
      <g stroke="var(--color-stitch)">
        <ellipse cx={92} cy={230} rx={58} ry={5} strokeDasharray="3 4" />
        <path d="M38 2H162M38 -2V6M162 -2V6" />
      </g>
      {DRAW_ORDER.map((id) => (
        <g key={id} data-part-base={id} stroke="var(--color-stitch)">
          {SHAPES[id]}
        </g>
      ))}
      {DRAW_ORDER.map((id) => (
        <g key={id} data-part-lit={id} data-on={lit(id) ? "" : undefined} className="anatomy-lit" stroke="var(--color-ecto)" style={order(id)}>
          {SHAPES[id]}
        </g>
      ))}
      {parts.map((p, i) => {
        const { at, side } = TARGETS[p.id];
        const edge = side === "left" ? VIEW.x : VIEW.x + VIEW.width;
        const marker = side === "left" ? VIEW.x + 7 : VIEW.x + VIEW.width - 7;
        const on = lit(p.id) ? "" : undefined;
        return (
          <g key={p.id} data-leader-for={p.id} style={order(p.id)}>
            <path
              data-leader={side}
              data-on={on}
              className="anatomy-leader"
              stroke="var(--color-stitch)"
              d={side === "left" ? `M${edge} ${at.y}H${at.x}` : `M${at.x} ${at.y}H${edge}`}
            />
            <circle data-on={on} className="anatomy-dot" cx={at.x} cy={at.y} r={2.2} fill="var(--color-ecto)" stroke="none" />
            {/* The lettered marker, shown only while the callouts sit below the drawing. */}
            <g className="@min-[58rem]:hidden">
              <circle cx={marker} cy={at.y} r={7} fill="var(--color-night-0)" stroke="var(--color-stitch)" />
              <text x={marker} y={at.y} dy="0.35em" textAnchor="middle" fontSize={9} fill="var(--color-ink-dim)" stroke="none" className="font-mono">
                {LETTERS[i]}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

export function Anatomy() {
  const { build } = LANDING;
  const { root, phase } = useSeen<HTMLDivElement>(0.6);
  const lit = (id: PartId) => phase(id) === "seen";
  return (
    <figure data-anatomy="" className="@container mt-6 flex flex-col gap-6">
      <figcaption className="font-mono text-xs text-ink-dim">{build.figure}</figcaption>
      <div
        ref={root}
        data-drawing-seen={phase("drawing") === "seen" ? "" : undefined}
        className="relative flex flex-col gap-12 @min-[58rem]:block @min-[58rem]:aspect-[1000/560]"
      >
        <div
          data-seen-key="drawing"
          className="mx-auto w-full max-w-80 @min-[58rem]:absolute @min-[58rem]:top-(--draw-top) @min-[58rem]:left-(--draw-left) @min-[58rem]:w-(--draw-width) @min-[58rem]:max-w-none"
          style={{ "--draw-top": DRAW_BOX.top, "--draw-left": DRAW_BOX.left, "--draw-width": DRAW_BOX.width } as CSSProperties}
        >
          <Drawing lit={lit} />
        </div>
        <ol className="grid grid-cols-1 gap-8 sm:grid-cols-2 @min-[58rem]:absolute @min-[58rem]:inset-0 @min-[58rem]:block">
          {build.parts.map((p, i) => {
            const left = TARGETS[p.id].side === "left";
            return (
              <li
                key={p.id}
                data-part={p.id}
                data-seen-key={p.id}
                className={`flex flex-col gap-1.5 @min-[58rem]:absolute @min-[58rem]:top-[calc(var(--y)_-_0.5rem)] @min-[58rem]:w-(--side) ${
                  left ? "@min-[58rem]:left-0 @min-[58rem]:items-end @min-[58rem]:text-right" : "@min-[58rem]:right-0 @min-[58rem]:items-start"
                }`}
                style={{ "--y": pct(leaderTop(p.id)), "--side": SIDE_WIDTH } as CSSProperties}
              >
                <FigLabel n={LETTERS[i]} side={left ? "right" : "left"}>
                  {p.pointsAt}
                </FigLabel>
                <h3 className="font-display text-2xl text-ink">{p.part}</h3>
                <p className="font-mono text-xs text-brass">{p.feature}</p>
                <p className="text-base text-ink-dim">{p.body}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </figure>
  );
}
