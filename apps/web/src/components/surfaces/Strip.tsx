"use client";
// The Strip (lab-ui-foundation R16.1, R16.2, R16.12): five terminals joined by a wire. Renders nothing
// while no loop is open.
// Brief 004 item 2: every terminal owns a label box of one fixed width (STRIP_LAYOUT.labelRem), at
// most two lines, with a fixed gap between neighbours. Across when the Strip's own container is at
// least STRIP_LAYOUT.acrossRem wide (five boxes and four gaps fit); below that, a column with the
// terminals down the side and the labels to the right. A container query, so the switch follows the
// space the Strip actually has, and a 343 px specimen shows the column.
// Brief 015: each terminal is a binding post. At rest a 14 px ink-dim ring; filled, an ecto core with
// the ecto glow; the fifth, filled, is gold and gives one burst of six short rays. The track is a
// dashed stitch line and the filled wire solid ecto. While the loop is open and not complete, one soft
// ecto pulse travels the newest filled segment. Labels are mono 12, the newest in ink.
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE, STAGGER } from "../../ui/motion";
import type { StripProps } from "../../ui/surface-props";

/** Sizes in rem behind the class strings below; Strip.test.tsx checks the two agree. */
export const STRIP_LAYOUT = { labelRem: 6, gapRem: 1, rowGapRem: 0.75, acrossRem: 34, terminals: 5 } as const;

/** One fixed width for every label box, at most two lines. */
export const LABEL_BOX = "w-24 shrink-0 line-clamp-2 break-words text-left @min-[34rem]:text-center";

/** Column below 34rem of container width, five 6rem tracks with 1rem gaps from there. */
export const STRIP_LIST = "flex flex-col gap-y-3 @min-[34rem]:grid @min-[34rem]:grid-cols-[repeat(5,6rem)] @min-[34rem]:justify-center @min-[34rem]:gap-x-4";

/** The binding post's size in px; the wires run through its centre. */
export const POST_PX = 14;

const TERMINAL = "relative flex flex-row items-center gap-3 @min-[34rem]:flex-col @min-[34rem]:gap-2";

/** Which wire carries the travelling pulse: the newest filled segment, while the loop is still open. */
export function pulseWire(filled: number): number | null {
  if (filled < 2 || filled >= STRIP_LAYOUT.terminals) return null;
  return filled - 2;
}

/** Which label reads in ink: the newest filled terminal, or none before the first fills. */
export function newestTerminal(filled: number): number | null {
  return filled > 0 ? filled - 1 : null;
}

/** The wire from this terminal's post to the next one's, along either axis. */
function Wire({ i, filled, reduced, axis }: { i: number; filled: number; reduced: boolean; axis: "x" | "y" }) {
  const lit = i < filled - 1;
  // Across: from the post centre (7 px down, mid-column) one column plus one gap to the right.
  // Down: from the post centre (7 px in, mid-row) one row plus one row gap down. The wire is 2 px.
  const track =
    axis === "x"
      ? "hidden @min-[34rem]:block left-1/2 top-[6px] h-0.5 w-[calc(100%+1rem)] franki-strip-track-x"
      : "block @min-[34rem]:hidden left-[6px] top-1/2 w-0.5 h-[calc(100%+0.75rem)] franki-strip-track-y";
  const origin = axis === "x" ? "origin-left" : "origin-top";
  const scale = axis === "x" ? { scaleX: lit ? 1 : 0 } : { scaleY: lit ? 1 : 0 };
  const pulse = !reduced && pulseWire(filled) === i;
  return (
    <span aria-hidden="true" data-wire-track={axis} className={`pointer-events-none absolute ${track}`}>
      {reduced ? (
        lit ? <span data-wire={i} data-axis={axis} className="absolute inset-0 bg-ecto" /> : null
      ) : (
        <motion.span
          data-wire={i}
          data-axis={axis}
          className={`absolute inset-0 ${origin} bg-ecto`}
          initial={false}
          animate={{ ...scale, opacity: lit ? 1 : 0 }}
          transition={{ duration: DUR.base / 1000, ease: [...EASE.ecto], delay: (i * STAGGER) / 1000 }}
        />
      )}
      {pulse ? (
        <span
          data-pulse={axis}
          className={`franki-anim absolute rounded-chip ${axis === "x" ? "franki-strip-pulse-x -top-0.5 left-0 h-1.5 w-[30%]" : "franki-strip-pulse-y -left-0.5 top-0 h-[30%] w-1.5"}`}
        />
      ) : null}
    </span>
  );
}

/** Six short gold rays, once, as the fifth post fills. Decorative. */
function Burst() {
  const rays = [0, 60, 120, 180, 240, 300];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-burst=""
      viewBox="-18 -18 36 36"
      className="franki-anim franki-strip-burst pointer-events-none absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-1/2 overflow-visible"
    >
      {rays.map((deg) => {
        const a = (deg * Math.PI) / 180;
        const r0 = 10;
        const r1 = 15;
        return (
          <line
            key={deg}
            x1={(Math.cos(a) * r0).toFixed(2)}
            y1={(Math.sin(a) * r0).toFixed(2)}
            x2={(Math.cos(a) * r1).toFixed(2)}
            y2={(Math.sin(a) * r1).toFixed(2)}
            stroke="var(--color-gold)"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

/** A binding post. The core lights after the current reaches it, one stagger step per terminal. */
function Post({ i, on, last, reduced }: { i: number; on: boolean; last: boolean; reduced: boolean }) {
  // The current reaches post i after i - 1 stagger steps and one wire fill; the first post has no wire.
  const delay = { "--post-i": Math.max(0, i - 1), "--post-wired": i === 0 ? 0 : 1 } as CSSProperties;
  // The fifth post keeps its rest ring; its gold lies on a cover that lights with the current, like the other cores.
  const ring = on && !last ? "border-ecto/70 bg-night-1" : "border-ink-dim bg-night-1";
  return (
    <span data-node="" className={`relative z-10 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${ring}`}>
      {on ? (
        last ? (
          <span
            aria-hidden="true"
            style={delay}
            className="franki-anim franki-strip-core mat-gold absolute -inset-[1.5px] flex items-center justify-center rounded-full border-[1.5px] border-gold"
          >
            {/* The gold post's screw head: a darker inner ring. */}
            <span className="size-1.5 rounded-full border border-night-0/35" />
          </span>
        ) : (
          <span aria-hidden="true" style={delay} className="franki-anim franki-strip-core size-2 rounded-full bg-ecto shadow-ecto-glow" />
        )
      ) : (
        // An empty post: a dark socket.
        <span aria-hidden="true" className="size-1 rounded-full bg-stitch" />
      )}
      {on && last && !reduced ? (
        <span aria-hidden="true" style={delay} className="pointer-events-none absolute inset-0">
          <Burst />
        </span>
      ) : null}
    </span>
  );
}

export function Strip({ open, filled, resultLabel }: StripProps) {
  const reduced = useReducedMotion();
  if (!open) return null;
  const labels = [...COPY.strip.terminals, resultLabel];
  const newest = newestTerminal(filled);
  return (
    <div className="@container w-full max-w-[343px] sm:max-w-xl">
      <ol aria-label={COPY.strip.label} data-strip="" data-filled={filled} className={STRIP_LIST}>
        {labels.map((label, i) => {
          const on = i < filled;
          const last = i === labels.length - 1;
          return (
            <li key={label + i} data-terminal={i} data-on={on ? "true" : "false"} className={TERMINAL}>
              {last ? null : (
                <>
                  <Wire i={i} filled={filled} reduced={reduced} axis="x" />
                  <Wire i={i} filled={filled} reduced={reduced} axis="y" />
                </>
              )}
              <Post i={i} on={on} last={last} reduced={reduced} />
              <span data-label-box="" className={`${LABEL_BOX} font-mono text-xs ${i === newest ? "text-ink" : "text-ink-dim"}`}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
