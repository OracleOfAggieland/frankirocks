// The hero block: the eyebrow, the page's only h1, the lede and the two ways in.
import { LANDING } from "../../ui/copy-landing";
import { FigLabel } from "../lab/FigLabel";
import { FOCUS, TARGET } from "../surfaces/classes";

export function Hero() {
  const { hero } = LANDING;
  return (
    <section id="top" data-step="hero" className="flex flex-col items-start gap-6 py-24 text-left">
      <p className="font-mono text-xs text-brass">{hero.eyebrow}</p>
      <h1 className="font-display text-hero text-ink">
        {hero.headline.before} <em>{hero.headline.stitched}</em> {hero.headline.after}
      </h1>
      <p className="max-w-[30rem] text-lg text-ink-dim">{hero.lede}</p>
      <div className="flex flex-wrap items-center gap-4">
        <a href="/lab" className={`${TARGET} ${FOCUS} mat-brass inline-flex items-center rounded-control px-5 text-base font-medium`}>
          {hero.wake}
        </a>
        <a href="#loop" className={`${TARGET} ${FOCUS} inline-flex items-center px-2 text-base text-ink-dim hover:text-ink`}>
          {hero.tour}
        </a>
      </div>
      <FigLabel n="1">{hero.scroll}</FigLabel>
    </section>
  );
}
