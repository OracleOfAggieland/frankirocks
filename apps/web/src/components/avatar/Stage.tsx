"use client";
// The stage (lab-ui-foundation R6.13, R12.1): Franki, a soft halo, and a faint floor shadow that narrows
// as Franki rises with the idle float. The halo and floor share the float's CSS timing.
// Franki is the largest thing on the screen: the stage is clamp(240px, 34vh, 340px) wide, never wider than
// its column, and never so wide that the three.js canvas (1.47 stage widths, 0.24 of them left of the box)
// passes the edges of the viewport: 100vw / 1.48 keeps the centred canvas inside it. The halo and the floor are
// sized in fractions of the stage, so both scale with it.
// `aside` is drawn over the stage and placed against it (the phone on Franki's wall); it takes no room, so the
// stage keeps its size whether or not anything hangs there.
import type { ReactNode } from "react";

/** The stage width (UI direction "Surfaces"). globals.css computes the canvas masks against this range. */
export const STAGE_WIDTH = "w-[clamp(240px,34vh,340px)]";

/** The stage's cap: its column, and a width at which the canvas still fits the viewport. */
export const STAGE_MAX = "max-w-[min(100%,calc(100vw/1.48))]";

export function Stage({ reduced, children, aside }: { reduced: boolean; children: ReactNode; aside?: ReactNode }) {
  const loop = reduced ? "" : " franki-anim";
  return (
    <div data-stage="" data-reduced={reduced ? "true" : "false"} className={`relative mx-auto flex ${STAGE_WIDTH} ${STAGE_MAX} flex-col items-center`}>
      <div
        aria-hidden="true"
        data-part="halo"
        className={`pointer-events-none absolute inset-[-20%] rounded-full opacity-60${loop}${reduced ? "" : " franki-halo"}`}
        style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--color-ecto) 22%, transparent), transparent)" }}
      />
      <div className="relative w-full">{children}</div>
      {/* A twelfth as tall as it is wide, 4% of the stage below Franki, at every stage size. */}
      <div
        aria-hidden="true"
        data-part="floor"
        className={`pointer-events-none mt-[4%] aspect-[12/1] w-3/5 rounded-full opacity-40${loop}${reduced ? "" : " franki-floor"}`}
        style={{ background: "radial-gradient(closest-side, var(--color-night-2), transparent)" }}
      />
      {aside}
    </div>
  );
}
