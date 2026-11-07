// A stitched seam: a dashed `stitch` line with short cross-ticks, for card tops and dividers. Decorative
// only, so it is hidden from assistive tech and is never a control boundary.
export function Seam() {
  return (
    <svg aria-hidden="true" focusable="false" data-seam="" className="block h-2 w-full" preserveAspectRatio="none" viewBox="0 0 100 8">
      <defs>
        <pattern id="franki-stitch" width="8" height="8" patternUnits="userSpaceOnUse">
          <line x1="0" y1="4" x2="5" y2="4" stroke="var(--color-stitch)" strokeWidth="1.2" />
          <line x1="2.5" y1="2" x2="2.5" y2="6" stroke="var(--color-stitch)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100" height="8" fill="url(#franki-stitch)" />
    </svg>
  );
}
