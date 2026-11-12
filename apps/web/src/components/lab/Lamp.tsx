// A lamp: an 8 px indicator, off in stitch and on in ecto with the ecto glow. The state is also a word for
// screen readers; the dot itself is decorative.
const WORDS = { on: "On", off: "Off" } as const;

export function Lamp({ on, words = WORDS }: { on: boolean; words?: { on: string; off: string } }) {
  return (
    <span data-lamp={on ? "on" : "off"} className="inline-flex items-center">
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block size-2 rounded-full transition-colors duration-(--dur-base) ${
          on ? "bg-ecto shadow-ecto-glow" : "border border-stitch bg-night-1"
        }`}
      />
      <span className="sr-only">{on ? words.on : words.off}</span>
    </span>
  );
}
