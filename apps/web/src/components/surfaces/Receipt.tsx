"use client";
// The Receipt (lab-ui-foundation R16.1, R16.6, R16.7, R16.12): a slip that prints up out of the Lab
// over dur.ritual after a forget. It shows "Blocked now", "Cleaned up", what was kept and counts by
// kind. Its props hold kinds and counts only, so forgotten words cannot reach it.
// Every row is a label on the left and its value on the right: a tick for a step that completed, `—`
// for one that has not, a count for what was kept and for each kind touched.
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE } from "../../ui/motion";
import type { ReceiptProps } from "../../ui/surface-props";

function Tick() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4">
      <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A completed step shows a tick, an open one `—`; both carry a text name for assistive tech. */
function Status({ done }: { done: boolean }) {
  return done ? (
    <span data-status="done" className="inline-flex items-center">
      <Tick />
      <span className="sr-only">{COPY.receipt.done}</span>
    </span>
  ) : (
    <span data-status="not-yet">
      <span aria-hidden="true">{COPY.lab.none}</span>
      <span className="sr-only">{COPY.receipt.notYet}</span>
    </span>
  );
}

function Row({ line, label, children }: { line: string; label: string; children: ReactNode }) {
  return (
    <div data-line={line} className="flex min-h-5 items-center justify-between gap-3">
      <dt>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

export function Receipt({ blocked, cleaned, kept, touched }: ReceiptProps) {
  const reduced = useReducedMotion();
  if (!blocked && !cleaned) return null;
  const keptShown = kept.filter((k) => k.count > 0);
  const touchedShown = touched.filter((t) => t.count > 0);
  return (
    <div className="w-60 max-w-full overflow-hidden">
      <motion.section
        aria-label={COPY.receipt.title}
        data-receipt=""
        className="flex w-full flex-col gap-2 rounded-control bg-ink p-3 text-left font-mono text-sm text-night-0"
        initial={reduced ? { opacity: 0 } : { y: "100%" }}
        animate={reduced ? { opacity: 1 } : { y: "0%" }}
        transition={{ duration: (reduced ? DUR.base : DUR.ritual) / 1000, ease: [...EASE.ecto] }}
      >
        <p aria-hidden="true" className="border-b border-dashed border-night-2 pb-1.5 text-xs">
          {COPY.receipt.title}
        </p>
        <dl className="flex flex-col gap-1">
          <Row line="blocked" label={COPY.receipt.blocked}>
            <Status done={blocked} />
          </Row>
          <Row line="cleaned" label={COPY.receipt.cleaned}>
            <Status done={cleaned} />
          </Row>
          {keptShown.map((k) => (
            <Row key={k.kind} line="kept" label={COPY.receipt.kept}>
              {COPY.receipt.safetyRules(k.count)}
            </Row>
          ))}
        </dl>
        {touchedShown.length > 0 ? (
          <div className="flex flex-col gap-1 border-t border-dashed border-night-2 pt-2">
            <p aria-hidden="true" className="text-xs">
              {COPY.receipt.touched}
            </p>
            <ul aria-label={COPY.receipt.touched} className="flex flex-col gap-1">
              {touchedShown.map((t) => (
                <li key={t.kind} data-kind={t.kind} className="flex min-h-5 items-center justify-between gap-3">
                  <span>{t.kind}</span>
                  <span className="tabular-nums">{t.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </motion.section>
    </div>
  );
}
