import type { ReactNode } from "react";

// A plate: a small brass label with engraved night-0 text. `tone="gold"` is for a win only.
const ENGRAVED = { textShadow: "0 1px 0 color-mix(in srgb, var(--color-spark) 45%, transparent)" } as const;

export function Plate({ children, tone = "brass" }: { children: ReactNode; tone?: "brass" | "gold" }) {
  return (
    <span
      data-plate={tone}
      className={`${tone === "gold" ? "mat-gold" : "mat-brass"} inline-flex items-center rounded-[4px] px-2 py-0.5 font-mono text-xs tracking-[0.08em]`}
      style={ENGRAVED}
    >
      {children}
    </span>
  );
}
