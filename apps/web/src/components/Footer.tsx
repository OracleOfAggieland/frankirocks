import { KIRO_URL } from "../ui/site";
import { SpiderToggle } from "./cursor/SpiderToggle";
import { FOCUS } from "./surfaces/classes";
import { Seam } from "./surfaces/Seam";

/** The stitched seam over the footer, faded out toward both ends. */
const FOOTER_SEAM = "pointer-events-none w-full max-w-md [mask-image:linear-gradient(to_right,transparent,black_25%,black_75%,transparent)]";

/** The footer text as a link: as tall as the row, so it is a full touch target, and underlined so it reads as one. */
const FOOTER_LINK = `${FOCUS} inline-flex min-h-11 items-center rounded-control px-1 underline decoration-ink-dim/50 underline-offset-4 transition-colors duration-(--dur-quick) hover:text-ink hover:decoration-ink`;

/**
 * The attribution footer (R16.7; steering structure.md Attribution). Rendered by the root layout on every page:
 * a seam, then the footer text exactly once, then the spider toggle. The text links to Kiro's site in a new tab,
 * so following it never ends a call.
 */
export function Footer() {
  return (
    <footer className="flex flex-col items-center gap-2 px-4 pb-4 pt-2 text-center text-xs text-ink-dim" data-testid="built-with-kiro">
      <div aria-hidden="true" data-footer-seam="" className={FOOTER_SEAM}>
        <Seam />
      </div>
      <div className="flex min-h-11 items-center justify-center gap-3">
        <a href={KIRO_URL} target="_blank" rel="noopener noreferrer" data-footer-text="" className={FOOTER_LINK}>
          Built with Kiro
        </a>
        <SpiderToggle />
      </div>
    </footer>
  );
}
