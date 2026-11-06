// WCAG 2.2 contrast ratios for the token pairings the Surfaces use (lab-ui-foundation R18.4).
// Pure: computed from the token values in motion.ts.
import { COLOR, type ColorToken } from "./motion";

export type PairingUse = "normal text" | "large text" | "control boundary";

export interface Pairing {
  readonly foreground: ColorToken;
  readonly background: ColorToken;
  readonly use: PairingUse;
}

/** Minimum ratio WCAG 2.2 AA asks for each use. */
export const MIN_RATIO: Record<PairingUse, number> = {
  "normal text": 4.5,
  "large text": 3,
  "control boundary": 3,
};

const BACKGROUNDS = ["night-0", "night-1", "night-2"] as const;

/** Every text and boundary pairing in use. `stitch` is decorative and never a control boundary. */
export const PAIRINGS: readonly Pairing[] = [
  ...BACKGROUNDS.flatMap((background) => [
    { foreground: "ink", background, use: "normal text" } as const,
    { foreground: "ink-dim", background, use: "normal text" } as const,
    { foreground: "brass", background, use: "normal text" } as const,
    { foreground: "ember", background, use: "normal text" } as const,
    { foreground: "ecto", background, use: "normal text" } as const,
    { foreground: "gold", background, use: "normal text" } as const,
    { foreground: "brass-hi", background, use: "normal text" } as const,
    { foreground: "brass", background, use: "control boundary" } as const,
    { foreground: "ink-dim", background, use: "control boundary" } as const,
    { foreground: "ember", background, use: "control boundary" } as const,
  ]),
  { foreground: "night-0", background: "brass", use: "normal text" },
  { foreground: "night-0", background: "ecto", use: "normal text" },
  { foreground: "night-0", background: "ember", use: "normal text" },
  { foreground: "gold", background: "night-0", use: "large text" },
];

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#RRGGBB` colour. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => channel(parseInt(x, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function pairingRatio(p: Pairing): number {
  return contrastRatio(COLOR[p.foreground], COLOR[p.background]);
}
