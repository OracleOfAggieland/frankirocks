// A stitched seam: a dashed `stitch` line with short cross-ticks, for card tops and dividers. Decorative
// only, so it is hidden from assistive tech, takes no pointer events and is never a control boundary.
// Drawn with dash arrays instead of an SVG pattern, so a seam needs no element ID: any number of seams can share
// a page, and one inside a hidden panel never blanks the others. No viewBox: the dashes are in CSS pixels, so
// every seam has the same stitch length whatever its width. One stitch is 14 px: a 9 px dash, a 5 px gap, and a
// 1 x 5 px tick across the middle of each dash.
// `fade` fades the seam out toward both ends, for a divider under a header.
const FADE_MASK = "linear-gradient(to right, transparent, black 18%, black 82%, transparent)";
const FADE = { maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK } as const;

export function Seam({ fade = false, className = "" }: { fade?: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-seam={fade ? "fade" : ""}
      className={`pointer-events-none block h-2 w-full shrink-0 ${className}`.trim()}
      width="100%"
      height="8"
      style={fade ? FADE : undefined}
    >
      <line x1="0" y1="4" x2="100%" y2="4" stroke="var(--color-stitch)" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="9 5" strokeDashoffset="-1" />
      <line x1="0" y1="4" x2="100%" y2="4" stroke="var(--color-stitch)" strokeWidth="5" strokeDasharray="1 13" strokeDashoffset="-5" />
    </svg>
  );
}
