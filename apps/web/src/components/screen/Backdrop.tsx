// The lab at night (lab-ui-foundation R12.4): a blueprint grid at about 3% opacity fading toward the
// edges, film grain from an SVG feTurbulence filter at about 4%, and a soft vignette, so Franki's halo
// is the only bright area on an empty screen. Decorative only.
export function Backdrop() {
  return (
    <div aria-hidden="true" data-backdrop="" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-night-0">
      <div
        data-layer="grid"
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-ink) 1px, transparent 1px), linear-gradient(90deg, var(--color-ink) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
      <svg data-layer="grain" className="absolute inset-0 h-full w-full opacity-[0.04]" focusable="false">
        <filter id="franki-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#franki-grain)" />
      </svg>
      <div
        data-layer="vignette"
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 45%, color-mix(in srgb, var(--color-night-0) 85%, transparent) 100%)" }}
      />
    </div>
  );
}
