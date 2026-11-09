"use client";
// The stage (lab-ui-foundation R6.13, R12.1): Franki, a soft halo, and a faint floor shadow that narrows
// as Franki rises with the idle float. The halo and floor share the float's CSS timing.
import type { ReactNode } from "react";

export function Stage({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  const loop = reduced ? "" : " franki-anim";
  return (
    <div data-stage="" data-reduced={reduced ? "true" : "false"} className="relative mx-auto flex w-full max-w-[240px] flex-col items-center">
      <div
        aria-hidden="true"
        data-part="halo"
        className={`pointer-events-none absolute inset-[-20%] rounded-full opacity-60${loop}${reduced ? "" : " franki-halo"}`}
        style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--color-ecto) 22%, transparent), transparent)" }}
      />
      <div className="relative w-full">{children}</div>
      <div
        aria-hidden="true"
        data-part="floor"
        className={`mt-2 h-3 w-3/5 rounded-full opacity-40${loop}${reduced ? "" : " franki-floor"}`}
        style={{ background: "radial-gradient(closest-side, var(--color-night-2), transparent)" }}
      />
    </div>
  );
}
