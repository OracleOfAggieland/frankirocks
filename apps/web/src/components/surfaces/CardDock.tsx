"use client";
// The Card_Dock (lab-ui-foundation R12.2, R15.6, R15.7, R16.12). One primary Card; up to two older
// ones stacked behind it at 96% and 92%. A right column at 1024 px and wider, a bottom sheet below.
// A Card rises in from the stage side with spring.settle.
import { motion } from "motion/react";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, SPRING } from "../../ui/motion";
import type { CardProps } from "../../ui/surface-props";
import { Card, cardHasContent } from "./Card";

export const STACK_SCALES = [1, 0.96, 0.92] as const;

export function CardDock({ cards }: { cards: CardProps[] }) {
  const reduced = useReducedMotion();
  const shown = cards.filter(cardHasContent).slice(0, STACK_SCALES.length);
  if (shown.length === 0) return null;
  return (
    <aside
      data-dock=""
      aria-label="Cards"
      className="fixed inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4 lg:static lg:inset-auto lg:z-auto lg:justify-start lg:px-0 lg:pb-0"
    >
      <div className="relative grid w-full max-w-[343px]">
        {shown
          .map((card, depth) => (
            <motion.div
              key={card.id}
              data-depth={depth}
              data-scale={STACK_SCALES[depth]}
              aria-hidden={depth > 0 ? true : undefined}
              inert={depth > 0 ? true : undefined}
              className="col-start-1 row-start-1 origin-top"
              style={{ zIndex: STACK_SCALES.length - depth }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -24, y: 12 }}
              animate={{ opacity: depth === 0 ? 1 : 0.6, x: 0, y: depth * -10, scale: STACK_SCALES[depth] }}
              transition={reduced ? { duration: DUR.base / 1000 } : { type: "spring", ...SPRING.settle }}
            >
              <Card {...card} />
            </motion.div>
          ))
          .reverse()}
      </div>
    </aside>
  );
}
