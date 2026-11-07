// The Wordmark (lab-ui-foundation R13.2, R16.11): "Franki" in the header, or FRANKIROCKS on the
// signed-out screen with K, I, R and O (letters 5 to 8) lighting gold once by a one-iteration CSS
// animation, staggered. Under Reduced_Motion they only fade to gold.

export const SIGNED_OUT_WORD = "FRANKIROCKS";
/** Zero-based indexes of K, I, R, O. */
export const LIT = [4, 5, 6, 7] as const;

export function Wordmark({ variant }: { variant: "header" | "signedOut" }) {
  if (variant === "header") {
    return (
      <span data-wordmark="header" className="text-lg font-medium text-ink">
        Franki
      </span>
    );
  }
  return (
    <h1 data-wordmark="signedOut" aria-label={SIGNED_OUT_WORD} className="font-mono text-2xl tracking-[0.3em] text-ink sm:text-display">
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
