"use client";
// The Receipt (lab-ui-foundation R16.1, R16.6, R16.7, R16.12): a slip that prints up out of the Lab
// over dur.ritual after a forget. It shows "Blocked now", "Cleaned up", what was kept and counts by
// kind. Its props hold kinds and counts only, so forgotten words cannot reach it.
import { motion } from "motion/react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE } from "../../ui/motion";
import type { ReceiptProps } from "../../ui/surface-props";

export function Receipt({ blocked, cleaned, kept, touched }: ReceiptProps) {
  const reduced = useReducedMotion();
  if (!blocked && !cleaned) return null;
  return (
    <div className="overflow-hidden">
      <motion.section
        aria-label={COPY.receipt.title}
        data-receipt=""
        className="flex w-full max-w-[343px] flex-col gap-1 rounded-control bg-ink p-3 text-left font-mono text-sm text-night-0 sm:w-56"
        initial={reduced ? { opacity: 0 } : { y: "100%" }}
        animate={reduced ? { opacity: 1 } : { y: "0%" }}
        transition={{ duration: (reduced ? DUR.base : DUR.ritual) / 1000, ease: [...EASE.ecto] }}
      >
        {blocked ? <p data-line="blocked">{COPY.receipt.blocked}</p> : null}
        {cleaned ? <p data-line="cleaned">{COPY.receipt.cleaned}</p> : null}
        {kept.filter((k) => k.count > 0).map((k) => (
          <p key={k.kind} data-line="kept">
            {COPY.receipt.kept(k.count)}
          </p>
        ))}
        {touched.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-0.5 border-t border-dashed border-night-2 pt-1">
            {touched.filter((t) => t.count > 0).map((t) => (
              <li key={t.kind} data-kind={t.kind} className="flex justify-between gap-3">
                <span>{t.kind}</span>
                <span className="tabular-nums">{t.count}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </motion.section>
    </div>
  );
}
