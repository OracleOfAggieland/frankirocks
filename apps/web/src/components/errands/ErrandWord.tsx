"use client";
// Brief 049 part A, ruling 12: the small word on the stage while an errand runs ("Checking your mail"). S0: it names
// only what is being looked through. It fades in and out; under Reduced_Motion it simply appears.
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE } from "../../ui/motion";

/** Under Franki, left of the stage's middle, clear of the phone's words and the radio. */
export const ERRAND_WORD_PLACE = "pointer-events-none absolute left-1/2 top-[92%] -translate-x-1/2 whitespace-nowrap font-mono text-xs text-ink-dim";

export function ErrandWord({ text }: { text: string | null }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {text === null ? null : (
        <motion.span
          key="errand-word"
          data-errand-word=""
          role="status"
          className={ERRAND_WORD_PLACE}
          initial={{ opacity: reduced ? 1 : 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : DUR.base / 1000, ease: EASE.ecto }}
        >
          {text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
