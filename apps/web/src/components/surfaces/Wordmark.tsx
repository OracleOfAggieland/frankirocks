// The Wordmark (lab-ui-foundation R13.2, R16.11): "Franki" in the header, or FRANKIROCKS on the
// signed-out screen with K, I, R and O (letters 5 to 8) lighting gold once by a one-iteration CSS
// animation, staggered. Under Reduced_Motion they only fade to gold. The word never wraps: it fits on
// one line from 375 px (text-2xl) and from 640 px (text-display). Letter spacing also trails the last
// letter, so a matching left pad keeps the word optically centred.

export const SIGNED_OUT_WORD = "FRANKIROCKS";
/** Zero-based indexes of K, I, R, O. */
export const LIT = [4, 5, 6, 7] as const;

/**
 * The small brass bolt beside "Franki" in the header: a struck-metal badge, lit from the top left, with a dark
 * lower edge. Decorative.
 */
function BrassBolt() {
  return (
    <svg viewBox="0 0 12 16" aria-hidden="true" focusable="false" data-wordmark-bolt="" className="h-4 w-3 shrink-0 overflow-visible">
      <path d="M7.6 0.8 L1.4 9.1 H5.6 L4.4 15.2 L10.6 6.6 H6.4 Z" fill="var(--color-brass)" stroke="color-mix(in srgb, var(--color-brass) 50%, var(--color-night-0))" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M7.6 0.8 L1.4 9.1 H5.6" fill="none" stroke="var(--color-brass-hi)" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ variant }: { variant: "header" | "signedOut" }) {
  if (variant === "header") {
    return (
      <span data-wordmark="header" className="inline-flex items-center gap-2 text-lg font-medium tracking-[0.01em] text-ink">
        <BrassBolt />
        <span>Franki</span>
      </span>
    );
  }
  return (
    <h1 data-wordmark="signedOut" aria-label={SIGNED_OUT_WORD} className="whitespace-nowrap pl-[0.3em] font-mono text-2xl tracking-[0.3em] text-ink sm:text-display">
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
    </h1>
  );
}
