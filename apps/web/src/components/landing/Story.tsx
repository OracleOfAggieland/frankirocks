// The story on the left: one block per step after the hero, grouped into the loop and memory sections, each
// with its intro. Each block is about one viewport tall from 1024 px and 70svh below. The active block is full
// strength and the others sit at 35%; until the page has measured itself every block is full strength, so the
// story reads completely with scripting off. Below 1024 px the column has a night-0 ground, so the text passes
// cleanly under the pinned stage.
import { LANDING, type StepCopy } from "../../ui/copy-landing";
import { STEP_IDS, STEP_SECTION, type StepId } from "../../ui/landing/steps";

const SECTION_INTRO = { loop: LANDING.sections.loop, memory: LANDING.sections.memory } as const;

/** Below 1024 px an anchor jump lands under the pinned stage, not behind it. */
const UNDER_STAGE = "max-lg:scroll-mt-[44svh]";

/** From this width the stage shows Franki's line itself, so the story's quote goes visually hidden. */
const SAYS_ON_STAGE = "min-[472px]:sr-only";

/** A small arrow for a hint. Decorative. */
function HintGlyph() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className="pointer-events-none size-3.5 shrink-0">
      <path d="M3 3.5v4.2a2 2 0 0 0 2 2h7.2M9.4 6.9l2.8 2.8-2.8 2.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Block({ id, copy, active, dim, level }: { id: StepId; copy: StepCopy; active: boolean; dim: boolean; level: "h2" | "h3" }) {
  const Title = level;
  const strength = active || !dim ? "opacity-100" : "opacity-35";
  return (
    <article
      id={`step-${id}`}
      data-step-block={id}
      data-active={active ? "true" : "false"}
      aria-labelledby={`step-${id}-title`}
      className={`flex min-h-[70svh] flex-col justify-center gap-4 py-12 transition-opacity duration-(--dur-base) ease-ecto lg:min-h-[85svh] ${strength} ${UNDER_STAGE}`}
    >
      {copy.kicker !== null ? <p className="font-mono text-xs tracking-[0.08em] text-brass">{copy.kicker}</p> : null}
      <Title id={`step-${id}-title`} className="font-display text-display leading-[1.08] text-ink text-balance">
        {copy.title}
      </Title>
      <p className="max-w-[30rem] text-lg text-ink-dim">{copy.body}</p>
      {copy.says !== undefined ? (
        // The one accessible copy of Franki's line. From 472 px the stage prints the same line under Franki (as
        // inert text), so here it is hidden visually only: screen readers still read it, sighted visitors read it once.
        <blockquote data-says="" className={`door-says max-w-[30rem] text-lg text-ink ${SAYS_ON_STAGE}`}>
          <p>{copy.says}</p>
        </blockquote>
      ) : null}
      {copy.hint !== undefined ? (
        <p className="inline-flex items-center gap-2 font-mono text-xs text-ink-dim">
          <HintGlyph />
          {copy.hint}
        </p>
      ) : null}
    </article>
  );
}

export interface StoryProps {
  step: StepId;
  /** Dim the blocks that are not active. Off until the page has measured itself. */
  dim?: boolean;
  className?: string;
}

export function Story({ step, dim = false, className = "" }: StoryProps) {
  const blocks = (section: "top" | "loop" | "memory") =>
    STEP_IDS.filter((id) => id !== "hero" && STEP_SECTION[id] === section).map((id) => (
      <Block key={id} id={id} copy={LANDING.steps[id]} active={id === step} dim={dim} level={section === "top" ? "h2" : "h3"} />
    ));
  return (
    <div id="story" data-story="" className={`flex flex-col text-left max-lg:bg-night-0 ${UNDER_STAGE} ${className}`.trim()}>
      {blocks("top")}
      {(["loop", "memory"] as const).map((section) => (
        <section key={section} id={section} aria-labelledby={`${section}-title`} className={`flex flex-col ${UNDER_STAGE}`}>
          <header className="flex flex-col gap-3 pb-4 pt-24">
            <p className="font-mono text-xs tracking-[0.08em] text-brass">{SECTION_INTRO[section].eyebrow}</p>
            <h2 id={`${section}-title`} className="font-display text-title text-ink text-balance">
              {SECTION_INTRO[section].title}
            </h2>
            <p className="max-w-[30rem] text-lg text-ink-dim">{SECTION_INTRO[section].body}</p>
            <span aria-hidden="true" className="door-seam mt-4 block w-40" />
          </header>
          {blocks(section)}
        </section>
      ))}
    </div>
  );
}
