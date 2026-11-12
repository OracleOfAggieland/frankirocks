// The hero block: the eyebrow, the page's only h1, the lede, the two ways in and a plain cue to scroll (not a
// figure: the stage's caption is FIG. 1). Below 1024 px it sits under the pinned stage, so its gaps are tight
// enough to show the headline and the brass button on a phone's first screen. The headline's words
// materialize one after another on the stagger, and a stitched underline draws itself under "stitched". Both are
// CSS animations in landing.css, so the words are in the HTML and show with scripting off; under reduced motion
// they simply fade in.
import type { CSSProperties } from "react";
import { LANDING } from "../../ui/copy-landing";
import { FOCUS, TARGET } from "../surfaces/classes";
import { BoltGlyph } from "./TopBar";

type WordStyle = CSSProperties & { "--i": number };

function Word({ children, i }: { children: string; i: number }) {
  const style: WordStyle = { "--i": i };
  return (
    <span data-hero-word="" className="door-word" style={style}>
      {children}
    </span>
  );
}

/** A small arrow pointing down the page. Decorative. */
function DownGlyph() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className="door-down pointer-events-none size-4 shrink-0">
      <path d="M8 2.5v10M3.8 8.6 8 12.8l4.2-4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Hero({ className = "" }: { className?: string }) {
  const { hero } = LANDING;
  const before = hero.headline.before.split(" ");
  const after = hero.headline.after.split(" ");
  const stitchedAt = before.length;
  const underline: WordStyle = { "--i": before.length + after.length + 1 };
  return (
    <section
      id="top"
      data-step-block="hero"
      aria-labelledby="hero-title"
      className={`flex flex-col items-start justify-center gap-3 pb-12 pt-4 text-left max-lg:scroll-mt-[44svh] sm:gap-4 sm:pt-6 lg:min-h-svh lg:gap-6 lg:py-24 ${className}`.trim()}
    >
      <p className="font-mono text-xs tracking-[0.08em] text-brass">{hero.eyebrow}</p>
      <h1 id="hero-title" className="font-display text-hero text-ink">
        {before.map((w, i) => (
          <span key={`b${i}`}>
            <Word i={i}>{w}</Word>{" "}
          </span>
        ))}
        <em data-hero-stitched="" className="door-word relative inline-block italic" style={{ "--i": stitchedAt } as WordStyle}>
          {hero.headline.stitched}
          <span aria-hidden="true" data-stitch-underline="" className="door-underline" style={underline}>
            <span className="door-underline-thread" />
          </span>
        </em>
        {after.map((w, i) => (
          <span key={`a${i}`}>
            {" "}
            <Word i={stitchedAt + 1 + i}>{w}</Word>
          </span>
        ))}
      </h1>
      <p className="max-w-[30rem] text-lg text-ink-dim">{hero.lede}</p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:pt-2">
        <a
          href="/lab"
          className={`${TARGET} ${FOCUS} mat-brass inline-flex min-h-12 items-center gap-2 rounded-control px-6 text-base font-medium transition-transform duration-(--dur-quick) ease-ecto active:translate-y-0.5`}
        >
          <BoltGlyph className="size-4" />
          {hero.wake}
        </a>
        <a
          href="#loop"
          className={`${TARGET} ${FOCUS} group inline-flex items-center gap-2 rounded-control px-2 text-base text-ink-dim transition-colors duration-(--dur-quick) hover:text-ink`}
        >
          {hero.tour}
          <DownGlyph />
        </a>
      </div>
      <p data-scroll-cue="" className="inline-flex items-center gap-2 pt-3 font-mono text-xs text-ink-dim lg:pt-6">
        {hero.scroll}
        <DownGlyph />
      </p>
    </section>
  );
}
