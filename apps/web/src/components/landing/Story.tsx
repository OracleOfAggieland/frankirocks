// The story on the left: one block per step after the hero, grouped into the loop and memory sections, each
// with its intro. The active step is full strength.
import { LANDING, type StepCopy } from "../../ui/copy-landing";
import { STEP_IDS, STEP_SECTION, type StepId } from "../../ui/landing/steps";

const SECTION_INTRO = { loop: LANDING.sections.loop, memory: LANDING.sections.memory } as const;

function Block({ id, copy, active }: { id: StepId; copy: StepCopy; active: boolean }) {
  return (
    <article data-step={id} data-active={active ? "true" : "false"} className={`flex flex-col gap-3 py-16 ${active ? "opacity-100" : "opacity-35"}`}>
      {copy.kicker !== null ? <p className="font-mono text-xs text-brass">{copy.kicker}</p> : null}
      <h3 className="font-display text-display text-ink">{copy.title}</h3>
      <p className="max-w-[30rem] text-lg text-ink-dim">{copy.body}</p>
      {copy.says !== undefined ? <blockquote className="max-w-[30rem] border-l border-stitch pl-4 text-lg text-ink">{copy.says}</blockquote> : null}
      {copy.hint !== undefined ? <p className="font-mono text-xs text-ink-dim">{copy.hint}</p> : null}
    </article>
  );
}

export function Story({ step }: { step: StepId }) {
  const blocks = (section: "top" | "loop" | "memory") =>
    STEP_IDS.filter((id) => id !== "hero" && STEP_SECTION[id] === section).map((id) => (
      <Block key={id} id={id} copy={LANDING.steps[id]} active={id === step} />
    ));
  return (
    <div id="story" data-story="" className="flex flex-col text-left">
      {blocks("top")}
      {(["loop", "memory"] as const).map((section) => (
        <section key={section} id={section} aria-labelledby={`${section}-title`} className="flex flex-col">
          <header className="flex flex-col gap-2 pt-16">
            <p className="font-mono text-xs text-brass">{SECTION_INTRO[section].eyebrow}</p>
            <h2 id={`${section}-title`} className="font-display text-title text-ink">
              {SECTION_INTRO[section].title}
            </h2>
            <p className="max-w-[30rem] text-lg text-ink-dim">{SECTION_INTRO[section].body}</p>
          </header>
          {blocks(section)}
        </section>
      ))}
    </div>
  );
}
