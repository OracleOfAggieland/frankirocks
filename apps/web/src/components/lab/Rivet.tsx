// A rivet: a 6 px brass dome. Decorative, so it is hidden from assistive tech and takes no pointer events.
const DOME = {
  background:
    "radial-gradient(circle at 35% 30%, var(--color-spark) 0%, var(--color-brass-hi) 22%, var(--color-brass) 58%, color-mix(in srgb, var(--color-brass) 55%, var(--color-night-0)) 100%)",
  boxShadow: "0 1px 1px color-mix(in srgb, var(--color-night-0) 60%, transparent)",
} as const;

export function Rivet({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" data-rivet="" className={`pointer-events-none inline-block size-1.5 shrink-0 rounded-full ${className}`.trim()} style={DOME} />;
}
