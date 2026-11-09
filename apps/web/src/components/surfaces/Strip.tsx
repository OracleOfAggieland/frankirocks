"use client";
// The Strip (lab-ui-foundation R16.1, R16.2, R16.12): five terminals joined by a wire. Filled
// terminals glow; current runs along the wire to each newly filled terminal, staggered; the last
// terminal turns gold when filled. Renders nothing while no loop is open.
// Brief 004 item 2: every terminal owns a label box of one fixed width (STRIP_LAYOUT.labelRem), at
// most two lines, with a fixed gap between neighbours. Across when the Strip's own container is at
// least STRIP_LAYOUT.acrossRem wide (five boxes and four gaps fit); below that, a column with the
// terminals down the side and the labels to the right. A container query, so the switch follows the
// space the Strip actually has, and a 343 px specimen shows the column.
import { motion } from "motion/react";
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

const TERMINAL = "relative flex flex-row items-center gap-3 @min-[34rem]:flex-col @min-[34rem]:gap-2";

/** The wire from this terminal's node to the next one's, along either axis. */
function Wire({ i, filled, reduced, axis }: { i: number; filled: number; reduced: boolean; axis: "x" | "y" }) {
  const lit = i < filled - 1;
  // Across: from the node centre (6 px down, mid-column) one column plus one gap to the right.
  // Down: from the node centre (6 px in, mid-row) one row plus one row gap down.
  const track =
    axis === "x"
      ? "hidden @min-[34rem]:block left-1/2 top-[5px] h-0.5 w-[calc(100%+1rem)]"
      : "block @min-[34rem]:hidden left-[5px] top-1/2 w-0.5 h-[calc(100%+0.75rem)]";
  const origin = axis === "x" ? "origin-left" : "origin-top";
  const scale = axis === "x" ? { scaleX: lit ? 1 : 0 } : { scaleY: lit ? 1 : 0 };
  return (
    <span aria-hidden="true" data-wire-track={axis} className={`pointer-events-none absolute bg-stitch ${track}`}>
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
    </span>
  );
}

export function Strip({ open, filled, resultLabel }: StripProps) {
  const reduced = useReducedMotion();
  if (!open) return null;
  const labels = [...COPY.strip.terminals, resultLabel];
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
              <span
                data-node=""
                className={`relative z-10 h-3 w-3 shrink-0 rounded-full border ${on ? (last ? "border-gold bg-gold shadow-brass-glow" : "border-ecto bg-ecto shadow-ecto-glow") : "border-ink-dim bg-night-1"}`}
              />
              <span
                data-label-box=""
                className={`${LABEL_BOX} text-xs ${on ? (last ? "text-gold" : "text-ink") : "text-ink-dim"} ${last ? "font-mono" : ""}`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
