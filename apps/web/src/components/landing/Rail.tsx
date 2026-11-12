"use client";
// The rail at the left edge, from 1024 px: a vertical wire, 56vh tall, with six terminals, one per section, each
// a link. The wire's track is a dashed stitch line; an ecto fill follows scroll progress through a spring, and it
// reaches each terminal exactly when its section is reached, because the progress is mapped piecewise from the
// sections' measured marks onto the evenly spaced terminals. A reached terminal lights ecto; the last one is gold
// once the switch is thrown. Below 1024 px the rail is a 2 px progress line under the bar. Under reduced motion
// the fill follows scroll directly and has no glow.
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { LANDING } from "../../ui/copy-landing";
import { evenMarks, railRange } from "../../ui/landing/scroll-step";
import { SECTION_IDS } from "../../ui/landing/steps";
import { SPRING } from "../../ui/motion";
import { FOCUS } from "../surfaces/classes";

const EVEN = evenMarks(SECTION_IDS.length);

export interface RailProps {
  /** The switch has been thrown. */
  won: boolean;
  /** The index of the last section reached, in SECTION_IDS order. */
  reached?: number;
  /** Where each section is reached, as a fraction of the page's scroll. Evenly spread until measured. */
  marks?: readonly number[];
  reduced?: boolean;
}

type PostState = "dark" | "lit" | "gold";

export function Rail({ won, reached = 0, marks = EVEN, reduced = true }: RailProps) {
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, { ...SPRING.settle, restDelta: 0.0005 });
  const source = reduced ? scrollYProgress : smooth;
  const range = marks.length === EVEN.length ? railRange(marks) : railRange(EVEN);
  const fill = useTransform(source, range, EVEN);
  const glow = reduced ? "" : "shadow-ecto-glow";
  const terminals = LANDING.rail.terminals;

  return (
    <>
      <nav
        aria-label={LANDING.rail.label}
        data-rail=""
        data-won={won ? "true" : "false"}
        className="fixed left-6 top-1/2 z-20 hidden h-[56vh] w-11 -translate-y-1/2 lg:block"
      >
        <span aria-hidden="true" data-rail-track="" className="door-rail-track pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2" />
        <motion.span
          aria-hidden="true"
          data-rail-fill=""
          className={`pointer-events-none absolute inset-y-0 left-1/2 -ml-px w-0.5 origin-top rounded-chip bg-ecto ${glow}`}
          style={{ scaleY: fill }}
        />
        <ol className="absolute inset-0">
          {terminals.map((t, i) => {
            const last = i === terminals.length - 1;
            const state: PostState = last && won ? "gold" : i <= reached ? "lit" : "dark";
            const current = i === reached;
            return (
              <li key={t.id} className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top: `${EVEN[i]! * 100}%` }}>
                <a
                  href={`#${t.id}`}
                  data-terminal={t.id}
                  data-state={state}
                  aria-current={current ? "location" : undefined}
                  className={`${FOCUS} group relative flex size-11 items-center justify-center rounded-full`}
                >
                  <span
                    aria-hidden="true"
                    data-post={state}
                    className={`door-post pointer-events-none ${state === "gold" ? "mat-gold" : ""} ${reduced ? "door-post-calm" : ""}`.trim()}
                  />
                  <span
                    className={`mat-glass pointer-events-none absolute left-full top-1/2 ml-1 -translate-y-1/2 whitespace-nowrap rounded-chip px-2.5 py-1 font-mono text-xs text-ink opacity-0 transition-opacity duration-(--dur-quick) ease-ecto group-hover:opacity-100 group-focus-visible:opacity-100 ${
                      current ? "min-[1400px]:opacity-100" : ""
                    }`}
                  >
                    {t.label}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
      <div aria-hidden="true" data-rail-line="" className="pointer-events-none fixed inset-x-0 top-14 z-30 h-0.5 md:top-16 lg:hidden">
        <span className="door-rail-line-track absolute inset-0" />
        <motion.span className={`absolute inset-0 origin-left bg-ecto ${glow}`} style={{ scaleX: source }} />
      </div>
    </>
  );
}
