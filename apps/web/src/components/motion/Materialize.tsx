"use client";
// Materialize and Dematerialize (lab-ui-foundation R9.3, R10.1, R10.2). Enter: rise 12 px, fade in,
// unblur 6 px to 0. Exit: rise 8 px, fade out, blur to 6 px. Under Reduced_Motion both become a plain
// opacity fade. Springs and durations come from the tokens.
import { AnimatePresence, type Transition, type Variants, motion } from "motion/react";
import type { ReactNode } from "react";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE, SPRING } from "../../ui/motion";

export function materializeVariants(reduced: boolean): Variants {
  if (reduced) {
    return { hidden: { opacity: 0 }, shown: { opacity: 1 }, gone: { opacity: 0 } };
  }
  return {
    hidden: { opacity: 0, y: 12, filter: "blur(6px)" },
    shown: { opacity: 1, y: 0, filter: "blur(0px)" },
    gone: { opacity: 0, y: -8, filter: "blur(6px)" },
  };
}

export function materializeTransition(reduced: boolean, spring: keyof typeof SPRING = "settle"): Transition {
  const fade = { duration: DUR.base / 1000, ease: [...EASE.ecto] as [number, number, number, number] };
  if (reduced) return fade;
  return { y: { type: "spring", ...SPRING[spring] }, opacity: fade, filter: fade };
}

export interface MaterializeProps {
  /** Present while true; leaves through Dematerialize when it turns false. */
  show: boolean;
  children: ReactNode;
  /** Distinguishes one item from the next, so a replacement leaves and enters. */
  itemKey?: string;
  spring?: keyof typeof SPRING;
  className?: string;
}

export function Materialize({ show, children, itemKey = "item", spring = "settle", className }: MaterializeProps) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key={itemKey}
          className={className}
          data-materialize={reduced ? "fade" : "full"}
          variants={materializeVariants(reduced)}
          initial="hidden"
          animate="shown"
          exit="gone"
          transition={materializeTransition(reduced, spring)}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
