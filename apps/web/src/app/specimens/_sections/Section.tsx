import type { ReactNode } from "react";

/** One labelled block of specimens. */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-section-id={id} aria-labelledby={`specimen-${id}`} className="flex w-full flex-col gap-4 border-t border-stitch py-8">
      <h2 id={`specimen-${id}`} className="text-lg text-ink">
        {title}
      </h2>
      <div className="flex flex-wrap items-start gap-6">{children}</div>
    </section>
  );
}

/** A captioned specimen tile. */
export function Tile({ label, children, ...data }: { label: string; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <figure {...data} className="flex flex-col items-center gap-2">
      {children}
      <figcaption className="max-w-[200px] text-center font-mono text-xs text-ink-dim">{label}</figcaption>
    </figure>
  );
}
