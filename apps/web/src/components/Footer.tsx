import { SpiderToggle } from "./cursor/SpiderToggle";
import { Seam } from "./surfaces/Seam";

/** The stitched seam over the footer, faded out toward both ends. */
const FOOTER_SEAM = "pointer-events-none w-full max-w-md [mask-image:linear-gradient(to_right,transparent,black_25%,black_75%,transparent)]";

/**
 * The attribution footer (R16.7; steering structure.md Attribution). Rendered by the root layout on every page:
 * a seam, then the footer text exactly once, then the spider toggle.
 */
export function Footer() {
  return (
    <footer className="flex flex-col items-center gap-2 px-4 pb-4 pt-2 text-center text-xs text-ink-dim" data-testid="built-with-kiro">
      <div aria-hidden="true" data-footer-seam="" className={FOOTER_SEAM}>
        <Seam />
      </div>
      <div className="flex min-h-11 items-center justify-center gap-3">
        <span data-footer-text="">Built with Kiro</span>
        <SpiderToggle />
      </div>
    </footer>
  );
}
