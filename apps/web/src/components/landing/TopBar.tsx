// The front door's top bar: a skip link, the wordmark linking to the top, the four section links and a brass
// "Wake Franki" link to the lab.
import { LANDING } from "../../ui/copy-landing";
import { FOCUS, TARGET } from "../surfaces/classes";

export function TopBar() {
  return (
    <header data-landing-bar="" className="flex w-full items-center justify-between gap-4 px-4 py-2">
      <a href="#story" className={`${FOCUS} sr-only focus:not-sr-only`}>
        {LANDING.bar.skip}
      </a>
      <a href="#top" aria-label={LANDING.bar.home} className={`${TARGET} ${FOCUS} inline-flex items-center font-mono text-sm tracking-[0.3em] text-ink`}>
        {LANDING.build.wordmark}
      </a>
      <nav aria-label={LANDING.rail.label} className="hidden items-center gap-2 md:flex">
        {LANDING.bar.links.map((link) => (
          <a key={link.id} href={`#${link.id}`} className={`${TARGET} ${FOCUS} inline-flex items-center px-2 text-sm text-ink-dim hover:text-ink`}>
            {link.label}
          </a>
        ))}
      </nav>
      <a href="/lab" className={`${TARGET} ${FOCUS} mat-brass inline-flex items-center rounded-control px-4 text-sm font-medium`}>
        {LANDING.bar.wake}
      </a>
    </header>
  );
}
