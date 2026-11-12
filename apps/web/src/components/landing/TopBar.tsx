// The front door's top bar: a skip link, the wordmark linking to the top, the four section links and a brass
// "Wake Franki" link to the lab. Fixed, 64 px tall (56 px below 768 px). Clear at the top of the page; once the
// page has scrolled 24 px a glass panel and a stitched seam fade in behind it.
import { useId } from "react";
import { LANDING } from "../../ui/copy-landing";
import type { SectionId } from "../../ui/landing/steps";
import { FOCUS, TARGET } from "../surfaces/classes";

/** The bar's section links, named apart from the rail's, which lists the same sections. */
const BAR_NAV_LABEL = "On this page";

/** Unlayered, so it outranks the `opacity-0` utility on the glass and the seam. */
const NOSCRIPT_GLASS = "[data-bar-glass],[data-bar-seam]{opacity:1}";

const BOLT_PATH = "M9.6 1.2 3.4 9.1h4.1l-1.2 5.7 6.3-8.2H8.4l1.2-5.4Z";

/** A lightning bolt, 16 by 16, filled with the current colour. Decorative. */
export function BoltGlyph({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className={`pointer-events-none shrink-0 ${className}`.trim()}>
      <path d={BOLT_PATH} fill="currentColor" />
    </svg>
  );
}

/** The wordmark's bolt: brass, lit on its upper face and darker below, with a fine bright edge. */
function BrassBolt() {
  const id = `bolt${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className="pointer-events-none size-4 shrink-0">
      <defs>
        <linearGradient id={id} x1="0.2" y1="0" x2="0.7" y2="1">
          <stop offset="0" style={{ stopColor: "var(--color-brass-hi)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--color-brass)" }} />
          <stop offset="1" style={{ stopColor: "color-mix(in srgb, var(--color-brass) 70%, var(--color-night-0))" }} />
        </linearGradient>
      </defs>
      <path d={BOLT_PATH} fill={`url(#${id})`} />
      <path d="M9.6 1.2 3.4 9.1h4.1" fill="none" strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--color-spark)", opacity: 0.55 }} />
    </svg>
  );
}

export interface TopBarProps {
  /** The page has scrolled past 24 px. */
  scrolled?: boolean;
  /** The section the visitor has reached; its link is marked as the current location. */
  section?: SectionId;
}

export function TopBar({ scrolled = false, section }: TopBarProps) {
  const glass = scrolled ? "opacity-100" : "opacity-0";
  return (
    <header data-landing-bar="" data-scrolled={scrolled ? "true" : "false"} className="fixed inset-x-0 top-0 z-30 h-14 md:h-16">
      {/* With scripting off the page never measures its scroll, so the glass and seam stay on to keep the bar readable. */}
      <noscript>
        <style>{NOSCRIPT_GLASS}</style>
      </noscript>
      <div
        aria-hidden="true"
        data-bar-glass=""
        className={`mat-glass pointer-events-none absolute inset-0 rounded-none transition-opacity duration-(--dur-base) ease-ecto ${glass}`}
      />
      <div aria-hidden="true" data-bar-seam="" className={`door-seam pointer-events-none absolute inset-x-0 bottom-0 transition-opacity duration-(--dur-base) ease-ecto ${glass}`} />
      <div className="relative mx-auto flex h-full w-full max-w-7xl items-center gap-2 px-4 sm:px-6">
        <a
          href="#story"
          className={`${FOCUS} mat-brass sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-1/2 focus:z-10 focus:inline-flex focus:min-h-11 focus:-translate-y-1/2 focus:items-center focus:rounded-control focus:px-4 focus:text-sm focus:font-medium`}
        >
          {LANDING.bar.skip}
        </a>
        <a href="#top" aria-label={LANDING.bar.home} className={`${TARGET} ${FOCUS} inline-flex items-center gap-2 rounded-control pr-2 font-mono text-sm tracking-[0.3em] text-ink`}>
          <BrassBolt />
          <span aria-hidden="true">{LANDING.build.wordmark}</span>
        </a>
        <nav aria-label={BAR_NAV_LABEL} className="ml-auto hidden items-center md:flex lg:gap-1">
          {LANDING.bar.links.map((link) => {
            const current = section === link.id;
            return (
              <a
                key={link.id}
                href={`#${link.id}`}
                aria-current={current ? "location" : undefined}
                className={`${TARGET} ${FOCUS} relative inline-flex items-center rounded-control px-2.5 text-sm transition-colors duration-(--dur-quick) hover:text-ink after:pointer-events-none after:absolute after:inset-x-2.5 after:bottom-2 after:h-px after:origin-left after:bg-brass after:transition-transform after:duration-(--dur-base) after:ease-ecto motion-reduce:after:transition-none hover:after:scale-x-100 ${
                  current ? "text-ink after:scale-x-100" : "text-ink-dim after:scale-x-0"
                }`}
              >
                {link.label}
              </a>
            );
          })}
        </nav>
        <a
          href="/lab"
          className={`${TARGET} ${FOCUS} mat-brass ml-auto inline-flex items-center gap-1.5 rounded-control px-4 text-sm font-medium transition-transform duration-(--dur-quick) ease-ecto active:translate-y-0.5 md:ml-2`}
        >
          <BoltGlyph className="size-3.5" />
          {LANDING.bar.wake}
        </a>
      </div>
    </header>
  );
}
