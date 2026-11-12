"use client";
// The Lab (lab-ui-foundation R16.1, R16.5, R16.12; brief 015 package E): an instrument panel of real counters.
// Glass with a rivet in each corner; a top bezel carrying the "The Lab" plate and a lamp that is lit while any
// counter has a value; one row per counter, its label beside an odometer in a dark well; and a fold for
// honest limits. With a `receipt`, a slot opens along the top edge and the slip prints up out of it. Below
// 640 px the slip sits in flow above the panel, so the column grows instead of covering what is above it; from
// 640 px it rises out of the slot over the room above the panel.
import type { ReactNode } from "react";
import { Lamp } from "../lab/Lamp";
import { Plate } from "../lab/Plate";
import { Rivet } from "../lab/Rivet";
import { COPY } from "../../ui/copy";
import { normalizeCount, placesFor } from "../../ui/instruments/odometer";
import type { LabProps } from "../../ui/surface-props";
import { FOCUS, TARGET } from "./classes";
import { Odometer } from "./Odometer";

const LAMP_WORDS = { on: COPY.lab.on, off: COPY.lab.off } as const;

function Chevron() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false" className="lab-chevron pointer-events-none size-3.5 shrink-0">
      <path d="M5 2.75 L9.5 7 L5 11.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type LabExtras = {
  /**
   * A slip to print from the slot. Pass `null` or leave it out unless a step completed (something was blocked
   * or cleaned): any element here opens the slot, even one that renders nothing.
   */
  receipt?: ReactNode;
};

export function Lab({ counters, limits, receipt }: LabProps & LabExtras) {
  // With no counts, a receipt still prints on its own.
  if (counters.length === 0) return receipt ? <>{receipt}</> : null;
  const counting = counters.some((c) => normalizeCount(c.value) !== null);
  const places = placesFor(counters.map((c) => c.value));
  const panel = (
    <section
      aria-label={COPY.lab.title}
      data-lab=""
      className={`mat-glass relative flex w-full flex-col rounded-card px-5 pb-2 text-left ${
        receipt ? "z-[2]" : "max-w-[343px] sm:w-72"
      }`}
    >
      {receipt ? (
        <span aria-hidden="true" data-lab-slot="" className="lab-slot pointer-events-none absolute left-1/2 top-0 z-[2] w-60 max-w-[calc(100%-24px)] -translate-x-1/2 -translate-y-1/2" />
      ) : null}
      <Rivet className="absolute left-2 top-2" />
      <Rivet className="absolute right-2 top-2" />
      <Rivet className="absolute bottom-2 left-2" />
      <Rivet className="absolute bottom-2 right-2" />
      <div
        data-lab-bezel=""
        className="-mx-5 flex min-h-11 items-center justify-between gap-3 rounded-t-card border-b border-ink/10 bg-night-0/35 px-6 pt-1"
      >
        <span aria-hidden="true" className="inline-flex">
          <Plate>{COPY.lab.title}</Plate>
        </span>
        <Lamp on={counting} words={LAMP_WORDS} />
      </div>
      <dl className="flex flex-col py-1">
        {counters.map((c) => (
          <div key={c.id} data-counter={c.id} className="flex min-h-11 items-center justify-between gap-3 border-b border-ink/5 last:border-b-0">
            <dt className="min-w-0 text-sm text-ink-dim">{c.label}</dt>
            <dd className="shrink-0 text-base">
              <Odometer value={c.value} places={places} />
            </dd>
          </div>
        ))}
      </dl>
      {limits.length > 0 ? (
        <details data-limits="" className="border-t border-ink/10 text-sm text-ink-dim">
          <summary
            className={`${FOCUS} ${TARGET} flex cursor-pointer list-none items-center gap-2 rounded-control transition-colors duration-(--dur-quick) hover:text-ink [&::-webkit-details-marker]:hidden`}
          >
            <Chevron />
            {COPY.lab.limits}
          </summary>
          <ul className="flex flex-col gap-1.5 pb-3 pl-5.5">
            {limits.map((l) => (
              <li key={l} className="lab-limit">
                {l}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
  if (!receipt) return panel;
  return (
    <div data-lab-column="" className="relative flex w-full max-w-[343px] flex-col items-center sm:w-72">
      {/* The slip's bottom edge tucks under the panel's top edge, where the slit is drawn over it. */}
      <div
        data-lab-receipt=""
        className="relative z-[1] -mb-0.5 flex w-60 max-w-[calc(100%-24px)] justify-center sm:absolute sm:bottom-[calc(100%-2px)] sm:left-1/2 sm:mb-0 sm:-translate-x-1/2"
      >
        {receipt}
      </div>
      {panel}
    </div>
  );
}
