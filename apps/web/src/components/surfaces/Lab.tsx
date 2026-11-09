"use client";
// The Lab (lab-ui-foundation R16.1, R16.5, R16.12): a small instrument panel of real counters in mono
// tabular figures, `—` for a count the server has not sent, and a fold for honest limits.
import { COPY } from "../../ui/copy";
import type { LabProps } from "../../ui/surface-props";
import { FOCUS, GLASS } from "./classes";
import { Odometer } from "./Odometer";

export function Lab({ counters, limits }: LabProps) {
  if (counters.length === 0) return null;
  return (
    <section aria-label={COPY.lab.title} data-lab="" className={`${GLASS} flex w-full max-w-[343px] flex-col gap-2 p-3 text-left sm:w-64`}>
      <dl className="flex flex-col gap-1">
        {counters.map((c) => (
          <div key={c.id} data-counter={c.id} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-ink-dim">{c.label}</dt>
            <dd className="text-sm text-ink">
              <Odometer value={c.value} />
            </dd>
          </div>
        ))}
      </dl>
      {limits.length > 0 ? (
        <details data-limits="" className="text-xs text-ink-dim">
          <summary className={`${FOCUS} flex min-h-11 cursor-pointer items-center rounded-control`}>{COPY.lab.limits}</summary>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            {limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
