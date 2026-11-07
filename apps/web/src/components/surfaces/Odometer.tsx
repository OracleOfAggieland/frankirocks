"use client";
// An odometer counter (lab-ui-foundation R16.5): a new value rolls up into place, by transform only;
// under Reduced_Motion it fades. `null` shows `—`, never a placeholder zero.
import { AnimatePresence, motion } from "motion/react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, SPRING } from "../../ui/motion";

export function formatCount(value: number | null): string {
  return value === null || !Number.isFinite(value) ? COPY.lab.none : Math.round(value).toLocaleString("en-US");
}

export function Odometer({ value }: { value: number | null }) {
  const reduced = useReducedMotion();
  const text = formatCount(value);
  return (
    <span data-odometer="" className="relative inline-flex overflow-hidden font-mono tabular-nums">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={text}
          initial={reduced ? { opacity: 0 } : { y: "100%" }}
          animate={reduced ? { opacity: 1 } : { y: "0%" }}
          exit={reduced ? { opacity: 0 } : { y: "-100%" }}
          transition={reduced ? { duration: DUR.base / 1000 } : { type: "spring", ...SPRING.settle }}
          className="inline-block"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
