// The build: the wordmark, the section's title and body, and the four parts of the anatomy.
import { LANDING } from "../../ui/copy-landing";

export function Build() {
  const { build, sections } = LANDING;
  return (
    <section id="build" aria-labelledby="build-title" className="flex flex-col gap-6 py-24 text-left">
      <p aria-label={build.wordmark} className="font-mono text-display tracking-[0.3em] text-ink">
        {build.wordmark}
      </p>
      <p className="font-mono text-xs text-brass">{sections.build.eyebrow}</p>
      <h2 id="build-title" className="font-display text-title text-ink">
        {sections.build.title}
      </h2>
      <p className="max-w-[30rem] text-lg text-ink-dim">{sections.build.body}</p>
      <figure className="flex flex-col gap-4">
        <figcaption className="font-mono text-xs text-ink-dim">{build.figure}</figcaption>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {build.parts.map((part) => (
            <div key={part.id} data-part={part.id} className="flex flex-col gap-1">
              <dt className="font-display text-2xl text-ink">{part.part}</dt>
              <dd className="font-mono text-xs text-brass">{part.feature}</dd>
              <dd className="text-base text-ink-dim">{part.body}</dd>
            </div>
          ))}
        </dl>
      </figure>
    </section>
  );
}
