"use client";
// The Strip (lab-ui-foundation R16.1, R16.2, R16.12): five terminals joined by a wire. Filled
// terminals glow; current runs along the wire to each newly filled terminal, staggered; the last
// terminal turns gold when filled. Renders nothing while no loop is open.
import { motion } from "motion/react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE, STAGGER } from "../../ui/motion";
import type { StripProps } from "../../ui/surface-props";

export function Strip({ open, filled, resultLabel }: StripProps) {
  const reduced = useReducedMotion();
  if (!open) return null;
  const labels = [...COPY.strip.terminals, resultLabel];
  return (
    <ol aria-label={COPY.strip.label} data-strip="" data-filled={filled} className="flex w-full max-w-[343px] items-start sm:max-w-xl">
      {labels.map((label, i) => {
        const on = i < filled;
        const last = i === labels.length - 1;
        return (
          <li key={label + i} data-terminal={i} data-on={on ? "true" : "false"} className="flex flex-1 flex-col items-center gap-1 last:flex-none">
            <div className="flex w-full items-center">
              <span
                data-node=""
                className={`h-3 w-3 shrink-0 rounded-full border ${on ? (last ? "border-gold bg-gold shadow-brass-glow" : "border-ecto bg-ecto shadow-ecto-glow") : "border-ink-dim bg-night-1"}`}
              />
              {last ? null : (
                <span className="relative h-0.5 flex-1 bg-stitch">
                  {reduced ? (
                    i < filled - 1 ? <span data-wire={i} className="absolute inset-0 bg-ecto" /> : null
                  ) : (
                    <motion.span
                      data-wire={i}
                      className="absolute inset-0 origin-left bg-ecto"
                      initial={false}
                      animate={{ scaleX: i < filled - 1 ? 1 : 0, opacity: i < filled - 1 ? 1 : 0 }}
                      transition={{ duration: DUR.base / 1000, ease: [...EASE.ecto], delay: (i * STAGGER) / 1000 }}
                    />
                  )}
                </span>
              )}
            </div>
            <span className={`text-xs ${on ? (last ? "text-gold" : "text-ink") : "text-ink-dim"} ${last ? "font-mono" : ""}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
