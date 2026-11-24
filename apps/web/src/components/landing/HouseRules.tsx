"use client";
// House rules: five riveted glass plaques, one per rule, three across from 1024 px, two from 640 px, one
// below. Each has a brass number plate, a blueprint line glyph of its rule, the title and the body. They
// materialize once, on STAGGER, as each enters view; one already in view when the page loads stays as it
// is. On hover a plaque lifts 2 px and its glyph turns from stitch to brass-hi (lower.css).
import { type Transition, type Variants, motion } from "motion/react";
import type { ReactNode } from "react";
import { LANDING } from "../../ui/copy-landing";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { STAGGER } from "../../ui/motion";
import { Plate } from "../lab/Plate";
import { Rivet } from "../lab/Rivet";
import { materializeTransition } from "../motion/Materialize";
import { type Seen, useSeen } from "./use-seen";

export type RuleId = (typeof LANDING.rules)[number]["id"];

/** Shared line settings for every glyph: a 48 px box, 1.5 px round linework in the current colour. */
const LINE = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const DOT = { fill: "currentColor", stroke: "none" } as const;

/** One blueprint line glyph per rule, drawn on a 48 by 48 grid. */
export const GLYPHS: Record<RuleId, ReactNode> = {
  // A peanut inside a no-entry ring: an allergen ruled out.
  allergies: (
    <>
      <circle cx={24} cy={24} r={19} />
      <g transform="rotate(45 24 24)">
        <path d="M20.2 24C17.2 21.6 16.6 16.8 18.8 13.8C21.2 10.4 26.8 10.4 29.2 13.8C31.4 16.8 30.8 21.6 27.8 24C31.4 26.4 32 31.6 29.4 34.8C26.8 38.2 21.2 38.2 18.6 34.8C16 31.6 16.6 26.4 20.2 24Z" />
        <path d="M21.6 15.6l.6.6M25.8 17.8l.6.6M21.2 30.4l.6.6M25.6 32.8l.6.6" />
      </g>
      <path d="M10.6 10.6L37.4 37.4" />
    </>
  ),
  // A stack of coins beside a closed padlock: money you can see but not move.
  money: (
    <>
      <ellipse cx={15} cy={24} rx={9} ry={3.2} />
      <path d="M6 24v12A9 3.2 0 0 0 24 36V24M6 30A9 3.2 0 0 0 24 30" />
      <rect x={27} y={25} width={14} height={12} rx={2} />
      <path d="M30 25v-3.5a4 4 0 0 1 8 0V25" />
      <circle cx={34} cy={30} r={1.4} />
      <path d="M34 31.4v2.4" />
    </>
  ),
  // Two traces whose peaks line up, joined by dashed guides: a pattern, read off two sources.
  patterns: (
    <>
      <path d="M5 18h7l4-8 4 8h8l4-8 4 8h7M5 37h7l4-8 4 8h8l4-8 4 8h7" />
      <path d="M16 7v34M32 7v34" strokeDasharray="2 3" />
      <circle cx={16} cy={10} r={1.4} {...DOT} />
      <circle cx={32} cy={10} r={1.4} {...DOT} />
      <circle cx={16} cy={29} r={1.4} {...DOT} />
      <circle cx={32} cy={29} r={1.4} {...DOT} />
    </>
  ),
  // A mote breaking open at its upper right, its pieces drifting off and thinning out: gone.
  forget: (
    <>
      <path d="M29.85 26.26A10 10 0 1 1 21.74 18.15" />
      <circle cx={28.2} cy={19.4} r={1.4} {...DOT} />
      <circle cx={33} cy={15.2} r={1.1} {...DOT} />
      <circle cx={37.4} cy={11.2} r={0.8} {...DOT} />
      <circle cx={41} cy={8} r={0.55} {...DOT} />
    </>
  ),
  // An envelope with an information mark: mail can inform.
  email: (
    <>
      <rect x={4} y={12} width={28} height={20} rx={2} />
      <path d="M5 13.5L18 23.5L31 13.5" />
      <circle cx={38} cy={35} r={6.5} />
      <circle cx={38} cy={31.9} r={0.9} {...DOT} />
      <path d="M38 34.6v4" />
    </>
  ),
};

export function RuleGlyph({ id }: { id: RuleId }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-glyph={id} className="lower-glyph pointer-events-none size-12 shrink-0" {...LINE}>
      {GLYPHS[id]}
    </svg>
  );
}

/**
 * Materialize: rise 12 px, fade in, unblur 6 px to 0; a plain fade under reduced motion. The filter is
 * removed once the plaque has settled, since a filter left on the plaque's parent would cut the glass off
 * from the backdrop it blurs. While it fades, its opacity already does that, so the blur costs nothing more.
 */
export function plaqueVariants(reduced: boolean): Variants {
  if (reduced) return { hidden: { opacity: 0 }, shown: { opacity: 1 } };
  return {
    hidden: { opacity: 0, y: 12, filter: "blur(6px)" },
    shown: { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } },
  };
}

/** Columns in the widest layout: the stagger counts across a row, so each row rises left to right. */
const ACROSS = 3;

export function plaqueTransition(reduced: boolean, seen: Seen, index: number): Transition {
  // A plaque still out of view hides at once, so nothing is seen fading out.
  if (seen === "waiting") return { type: false };
  return { ...materializeTransition(reduced), delay: ((index % ACROSS) * STAGGER) / 1000 };
}

export function HouseRules() {
  const { rules, sections } = LANDING;
  const reduced = useReducedMotion();
  const { root, phase } = useSeen<HTMLOListElement>(0.3);
  const variants = plaqueVariants(reduced);
  return (
    <section id="rules" aria-labelledby="rules-title" className="flex flex-col gap-6 py-24 text-left">
      <p className="font-mono text-xs text-brass">{sections.rules.eyebrow}</p>
      <h2 id="rules-title" className="font-display text-title text-ink">
        {sections.rules.title}
      </h2>
      <p className="max-w-[30rem] text-lg text-ink-dim">{sections.rules.body}</p>
      <ol ref={root} className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {rules.map((rule, i) => {
          const seen = phase(rule.id);
          return (
            <motion.li
              key={rule.id}
              data-rule={rule.id}
              data-seen-key={rule.id}
              className="flex"
              variants={variants}
              initial={false}
              animate={seen === "waiting" ? "hidden" : "shown"}
              transition={plaqueTransition(reduced, seen, i)}
            >
              <div data-plaque="" className="lower-plaque mat-glass relative flex w-full flex-col gap-4 rounded-card p-6 pt-7">
                <Rivet className="absolute top-2.5 left-2.5" />
                <Rivet className="absolute top-2.5 right-2.5" />
                <Rivet className="absolute bottom-2.5 left-2.5" />
                <Rivet className="absolute right-2.5 bottom-2.5" />
                <div className="flex items-start justify-between gap-4">
                  <Plate>{String(i + 1).padStart(2, "0")}</Plate>
                  <RuleGlyph id={rule.id} />
                </div>
                <h3 className="text-lg text-ink">{rule.title}</h3>
                <p className="text-base text-ink-dim">{rule.body}</p>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}
