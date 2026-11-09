// A stitched seam: a dashed `stitch` line with short cross-ticks, for card tops and dividers. Decorative
// only, so it is hidden from assistive tech and is never a control boundary.
// No viewBox: the pattern is in CSS pixels, so every seam has the same stitch length whatever its width.
export function Seam() {
  return (
    <svg aria-hidden="true" focusable="false" data-seam="" className="block h-2 w-full" width="100%" height="8">
      <defs>
        <pattern id="franki-stitch" width="14" height="8" patternUnits="userSpaceOnUse">
          <line x1="1" y1="4" x2="10" y2="4" stroke="var(--color-stitch)" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="5.5" y1="1.5" x2="5.5" y2="6.5" stroke="var(--color-stitch)" strokeWidth="1" strokeLinecap="round" />
        </pattern>
      </defs>
      <rect width="100%" height="8" fill="url(#franki-stitch)" />
    </svg>
  );
}
