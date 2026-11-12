"use client";
// The build: FRANKIROCKS in large mono, with K, I, R and O lighting gold once when the whole word is in
// view (the Wordmark's .franki-kiro, held until then by lower.css), then the section's title and body, then
// the anatomy. The word scales with its container so it stays on one line from 375 px up.
import { LANDING } from "../../ui/copy-landing";
import { LIT, SIGNED_OUT_WORD } from "../surfaces/Wordmark";
import { Anatomy } from "./Anatomy";
import { useSeen } from "./use-seen";

export function Build() {
  const { sections } = LANDING;
  const { root, phase } = useSeen<HTMLDivElement>(0.9);
  const seen = phase("word") === "seen";
  return (
    <section id="build" aria-labelledby="build-title" className="flex flex-col gap-6 py-24 text-left">
      <div ref={root} className="@container w-full">
        {/* One image named by the word: a paragraph alone may not carry a name, and every letter is hidden. */}
        <p
          role="img"
          aria-label={SIGNED_OUT_WORD}
          data-kiro-word=""
          data-seen-key="word"
          data-seen={seen ? "" : undefined}
          className="lower-word whitespace-nowrap pl-[0.3em] text-center font-mono leading-none tracking-[0.3em] text-ink"
        >
          {[...SIGNED_OUT_WORD].map((ch, i) => {
            const lit = (LIT as readonly number[]).indexOf(i);
            return lit < 0 ? (
              <span key={i} aria-hidden="true">
                {ch}
              </span>
            ) : (
              <span key={i} aria-hidden="true" data-lit="" className="franki-kiro" style={{ animationDelay: `calc(var(--stagger) * ${lit * 3})` }}>
                {ch}
              </span>
            );
          })}
        </p>
      </div>
      <div className="mx-auto flex max-w-[36rem] flex-col items-center gap-4 text-center">
        <p className="font-mono text-xs text-brass">{sections.build.eyebrow}</p>
        <h2 id="build-title" className="font-display text-title text-ink">
          {sections.build.title}
        </h2>
        <p className="max-w-[30rem] text-lg text-ink-dim">{sections.build.body}</p>
      </div>
      <Anatomy />
    </section>
  );
}
