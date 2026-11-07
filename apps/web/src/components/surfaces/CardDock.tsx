"use client";
// The Card_Dock (lab-ui-foundation R12.2, R15.6, R15.7, R16.12). One primary Card; up to two older
// ones stacked behind it at 96% and 92%. A right column at 1024 px and wider, a bottom sheet below.
// A Card rises in from the stage side with spring.settle.
// Older cards show only their edges: each is an empty glass shell the size of the primary Card,
// lifted so its top edge peeks out above it. No text from an older card is drawn, and the shells are
// inert and hidden from assistive tech.
import { motion } from "motion/react";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, SPRING } from "../../ui/motion";
import type { CardProps } from "../../ui/surface-props";
import { Card, cardHasContent } from "./Card";
import { GLASS } from "./classes";

export const STACK_SCALES = [1, 0.96, 0.92] as const;
/** How far each older card's top edge peeks out above the one in front, in px. */
export const STACK_PEEK = 8;
const STACK_OPACITY = [1, 0.75, 0.5] as const;

export function CardDock({ cards }: { cards: CardProps[] }) {
  const reduced = useReducedMotion();
  const shown = cards.filter(cardHasContent).slice(0, STACK_SCALES.length);
  if (shown.length === 0) return null;
  const lift = (shown.length - 1) * STACK_PEEK;
  return (
    <aside
      data-dock=""
      aria-label="Cards"
      className="fixed inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4 lg:static lg:inset-auto lg:z-auto lg:justify-start lg:px-0 lg:pb-0"
    >
      <div className="relative w-full max-w-[343px]" style={{ paddingTop: lift }}>
        {shown
          .map((card, depth) => {
            const front = depth === 0;
            return (
              <motion.div
                key={card.id}
                data-depth={depth}
                data-scale={STACK_SCALES[depth]}
                aria-hidden={front ? undefined : true}
                inert={front ? undefined : true}
                className={front ? "relative origin-top" : "absolute inset-x-0 bottom-0 origin-top"}
                style={{ zIndex: STACK_SCALES.length - depth, top: front ? undefined : lift }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: -24, y: 12 }}
                animate={{ opacity: STACK_OPACITY[depth], x: 0, y: depth * -STACK_PEEK, scale: STACK_SCALES[depth] }}
                transition={reduced ? { duration: DUR.base / 1000 } : { type: "spring", ...SPRING.settle }}
              >
                {front ? <Card {...card} /> : <div data-stack-edge="" className={`${GLASS} h-full w-full border border-stitch`} />}
              </motion.div>
            );
          })
          .reverse()}
      </div>
    </aside>
  );
}
