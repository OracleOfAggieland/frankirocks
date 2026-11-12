"use client";
// The Receipt (lab-ui-foundation R16.1, R16.6, R16.7, R16.12; brief 015 package E): a paper slip with perforated
// ends that prints upward out of its slot in eight pushes over dur.ritual after a forget. It shows "Blocked now"
// and "Cleaned up", what was kept (with a small printed seal), and counts by kind. Its props hold kinds and
// counts only, so forgotten words cannot reach it.
// Every row is a label, a dotted leader and a value: a drawn tick for a step that completed, `—` for one that has
// not, a count for what was kept and for each kind touched. Under Reduced_Motion the slip fades in where it stands.
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { feedKeyframes } from "../../ui/instruments/print-feed";
import { DUR, EASE } from "../../ui/motion";
import type { ReceiptProps } from "../../ui/surface-props";

const FEED = feedKeyframes();
const FEED_EASE = FEED.pushes.map((push) => (push ? EASE.ecto : ("linear" as const)));

/** A tick drawn the way a pen makes one: a short down-stroke, then a long sweep up. */
function Tick() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4">
      <path
        d="M2.6 8.9 C3.9 9.6 5.1 10.9 6.2 12.7 C8 8.9 10.4 5.7 13.5 3.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A scalloped edge of twelve lobes round the centre of a 16 px box. */
const SCALLOP = (() => {
  const lobes = 12;
  const valley = 6.3;
  const peak = 8.1;
  const at = (r: number, a: number) => `${(8 + r * Math.cos(a)).toFixed(2)} ${(8 + r * Math.sin(a)).toFixed(2)}`;
  let d = `M${at(valley, 0)}`;
  for (let i = 0; i < lobes; i += 1) {
    const a0 = (i / lobes) * 2 * Math.PI;
    const a1 = ((i + 1) / lobes) * 2 * Math.PI;
    d += ` Q${at(peak, (a0 + a1) / 2)} ${at(valley, a1)}`;
  }
  return `${d} Z`;
})();

/** The seal of a kept safety rule, printed in ink: a scalloped stamp, an inner ring and a lock. */
function PrintedSeal() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" data-receipt-seal="" className="h-3.5 w-3.5 shrink-0">
      <path d={SCALLOP} fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="4.7" fill="none" stroke="currentColor" strokeWidth="0.6" />
      <path d="M6.5 7.7 V6.6 A1.5 1.5 0 0 1 9.5 6.6 V7.7" fill="none" stroke="currentColor" strokeWidth="0.9" />
      <rect x="5.7" y="7.6" width="4.6" height="3.3" rx="0.6" fill="currentColor" />
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
    <div data-line={line} className="receipt-row flex min-h-6 items-center gap-1.5">
      <dt>{label}</dt>
      <dd className="inline-flex shrink-0 items-center gap-1.5 tabular-nums">{children}</dd>
    </div>
  );
}

export function Receipt({ blocked, cleaned, kept, touched }: ReceiptProps) {
  const reduced = useReducedMotion();
  if (!blocked && !cleaned) return null;
  const keptShown = kept.filter((k) => k.count > 0);
  const touchedShown = touched.filter((t) => t.count > 0);
  return (
    // The slot: the slip starts wholly below this box's bottom edge and feeds up into view.
    <div data-receipt-feed="" className="w-60 max-w-full overflow-hidden px-2 pt-2">
      <motion.div
        // A change of mode mounts a fresh slip, so a fade never strands it half-seen when the feed takes over.
        key={reduced ? "still" : "feed"}
        className="receipt-slip"
        initial={reduced ? { opacity: 0 } : { y: FEED.y[0] }}
        animate={reduced ? { opacity: 1 } : { y: FEED.y }}
        transition={reduced ? { duration: DUR.base / 1000, ease: "linear" } : { duration: DUR.ritual / 1000, times: FEED.times, ease: FEED_EASE }}
      >
        <section aria-label={COPY.receipt.title} data-receipt="" className="receipt-paper mat-paper flex w-full flex-col gap-2 px-3.5 py-4 text-left font-mono text-sm">
          <p aria-hidden="true" className="border-b border-dashed border-night-0/45 pb-2 text-center text-xs tracking-[0.18em]">
            {COPY.receipt.title}
          </p>
          <dl className="flex flex-col gap-0.5">
            <Row line="blocked" label={COPY.receipt.blocked}>
              <Status done={blocked} />
            </Row>
            <Row line="cleaned" label={COPY.receipt.cleaned}>
              <Status done={cleaned} />
            </Row>
            {keptShown.map((k) => (
              <Row key={k.kind} line="kept" label={COPY.receipt.kept}>
                {COPY.receipt.safetyRules(k.count)}
                <PrintedSeal />
              </Row>
            ))}
          </dl>
          {touchedShown.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-dashed border-night-0/45 pt-2">
              <p aria-hidden="true" className="text-xs">
                {COPY.receipt.touched}
              </p>
              <ul aria-label={COPY.receipt.touched} className="flex flex-col gap-0.5">
                {touchedShown.map((t) => (
                  <li key={t.kind} data-kind={t.kind} className="flex min-h-6 items-center gap-1.5">
                    <span className="receipt-leader">{t.kind}</span>
                    <span className="shrink-0 tabular-nums">{t.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <span aria-hidden="true" className="block border-t border-dashed border-night-0/45" />
        </section>
      </motion.div>
    </div>
  );
}
