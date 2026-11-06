// Token_File (lab-ui-foundation R2.4, R2.5). A hand-written mirror of the `@theme static` block in
// apps/web/src/app/globals.css, which holds the authoritative values. Not generated.
// scripts/token-sync.test.ts fails when a value here differs from globals.css.

export const COLOR = {
  "night-0": "#060A09",
  "night-1": "#0B1311",
  "night-2": "#13201C",
  ink: "#E8F4EC",
  "ink-dim": "#9DB3A8",
  ghost: "#CDF3D3",
  "ghost-deep": "#93DDA2",
  ecto: "#7CFFB2",
  brass: "#D9A441",
  "brass-hi": "#F3CF7A",
  gold: "#FFD24D",
  spark: "#FFF6D8",
  stitch: "#3B4C45",
  ember: "#FF6A4D",
} as const;

export type ColorToken = keyof typeof COLOR;

export interface Spring {
  readonly stiffness: number;
  readonly damping: number;
}

export const SPRING = {
  float: { stiffness: 60, damping: 12 },
  settle: { stiffness: 170, damping: 22 },
  press: { stiffness: 420, damping: 30 },
} as const satisfies Record<string, Spring>;

/** Durations in milliseconds. */
export const DUR = { quick: 160, base: 320, ritual: 1200 } as const;

/** Cubic-bezier control points. */
export const EASE = { ecto: [0.22, 1, 0.36, 1] } as const;

/** Stagger between list items and strip terminals, in milliseconds. */
export const STAGGER = 40;

/** How long each timed Avatar_Event lasts, in Frame_Time milliseconds (design "Look_Mapper"). */
export const EVENT_MS = {
  wake: DUR.ritual,
  "present-card": 800,
  celebrate: 1600,
} as const;
