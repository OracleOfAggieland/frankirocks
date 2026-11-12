// The odometer's digit maths (brief 015 package E). Pure: which drum shows which digit, which places stand
// empty, and how far each drum rolls when the count changes. The component only draws what this returns.
//
// Cells are keyed by their place counted from the right (`p0` is the ones drum), so a drum keeps its
// identity when the number grows or shrinks and rolls from the digit it was showing.
import { COPY } from "../copy";

/** Degrees between two faces of a ten-face drum. */
export const FACE_DEG = 36;

/** The fewest digit places the Lab gives every counter, so short numbers line up in one column. */
export const MIN_PLACES = 3;

/** The most places a drum bank is laid out for. Larger counts still show, with more drums. */
export const MAX_PLACES = 15;

const LOCALE = "en-US";

/** A count as the odometer holds it: a whole number, or null when there is nothing true to show. */
export function normalizeCount(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  // `+ 0` turns -0 into 0, so a value that rounds to zero never prints "-0".
  return Math.round(value) + 0;
}

/** The count as text: en-US grouping, and `—` for a missing value, never a placeholder zero. */
export function formatCount(value: number | null): string {
  const n = normalizeCount(value);
  return n === null ? COPY.lab.none : n.toLocaleString(LOCALE);
}

export type OdometerCell =
  /** A drum turned to `digit`. */
  | { readonly kind: "drum"; readonly key: string; readonly digit: number }
  /** A character that stands still between drums: a group separator, or a sign. */
  | { readonly kind: "still"; readonly key: string; readonly char: string }
  /** A leading place the number does not reach yet: an empty window, or the gap a separator will fill. */
  | { readonly kind: "empty"; readonly key: string; readonly slot: "drum" | "still" }
  /** The missing-value mark on a blank drum, in the ones place. */
  | { readonly kind: "dash"; readonly key: string };

const isDigit = (c: string) => c >= "0" && c <= "9";
const keyAt = (fromRight: number) => `p${fromRight}`;

function clampPlaces(places: number): number {
  return Number.isFinite(places) ? Math.min(MAX_PLACES, Math.max(1, Math.floor(places))) : 1;
}

/** The grouped template of a bank with this many digit places, such as "0,000" for four. */
export function templateFor(places: number): string {
  return (10 ** (clampPlaces(places) - 1)).toLocaleString(LOCALE).replace(/\d/g, "0");
}

/** The digit places a count needs. Null and zero need one. */
export function digitsIn(value: number | null): number {
  const n = normalizeCount(value);
  return n === null ? 1 : String(Math.abs(n)).length;
}

/** One place count for a bank of counters: the widest value, and never fewer than `min`. */
export function placesFor(values: readonly (number | null)[], min = MIN_PLACES): number {
  return clampPlaces(Math.max(min, ...values.map(digitsIn)));
}

/**
 * The cells of a bank of `places` digit drums showing `value`, left to right. For any whole number with no
 * more digits than `places`, the cell kinds by position never change: the bank's width stands still.
 */
export function layoutOdometer(value: number | null, places: number): OdometerCell[] {
  const n = normalizeCount(value);
  const template = templateFor(places);
  const text = n === null ? "" : n.toLocaleString(LOCALE);
  const width = Math.max(template.length, text.length);
  const cells: OdometerCell[] = [];
  for (let i = width - 1; i >= 0; i -= 1) {
    const key = keyAt(i);
    if (n === null && i === 0) {
      cells.push({ kind: "dash", key });
      continue;
    }
    if (i < text.length) {
      const c = text[text.length - 1 - i];
      cells.push(isDigit(c) ? { kind: "drum", key, digit: Number(c) } : { kind: "still", key, char: c });
      continue;
    }
    const t = template[template.length - 1 - i];
    cells.push({ kind: "empty", key, slot: t !== undefined && isDigit(t) ? "drum" : "still" });
  }
  return cells;
}

const mod10 = (x: number) => ((x % 10) + 10) % 10;

/**
 * How far a drum turns to show `digit`, in faces: forward (`direction` >= 0) or backward, never more than
 * nine faces, never a full turn for nothing.
 */
export function rollSteps(turn: number, digit: number, direction: number): number {
  const showing = mod10(turn);
  return direction >= 0 ? mod10(digit - showing) : -mod10(showing - digit);
}

export interface RollState {
  /** The normalized value the drums show. */
  readonly value: number | null;
  readonly places: number;
  /** Each drum's turn, in faces. `turn mod 10` is the digit at the front; the total only grows or shrinks by rolls. */
  readonly turns: Readonly<Record<string, number>>;
  /** Drums that appeared in the last change and had nothing to roll from. */
  readonly fresh: readonly string[];
}

/** The drums at rest on a first value: every drum already shows its digit. */
export function startRoll(value: number | null, places: number): RollState {
  const turns: Record<string, number> = {};
  for (const cell of layoutOdometer(value, places)) if (cell.kind === "drum") turns[cell.key] = cell.digit;
  return { value: normalizeCount(value), places, turns, fresh: [] };
}

/**
 * The drums after a change. A rising count rolls every drum forward, a falling one rolls them back, the way
 * a real counter turns. A drum the old number did not reach appears showing its digit.
 */
export function advanceRoll(prev: RollState, value: number | null, places: number): RollState {
  const n = normalizeCount(value);
  const direction = prev.value !== null && n !== null ? Math.sign(n - prev.value) : 0;
  const turns: Record<string, number> = {};
  const fresh: string[] = [];
  for (const cell of layoutOdometer(n, places)) {
    if (cell.kind !== "drum") continue;
    const was = prev.turns[cell.key];
    if (was === undefined) {
      turns[cell.key] = cell.digit;
      fresh.push(cell.key);
    } else {
      turns[cell.key] = was + rollSteps(was, cell.digit, direction);
    }
  }
  return { value: n, places, turns, fresh };
}

/** The drum's rotation for a turn, in degrees. Face `d` sits at `-d * FACE_DEG`, so turn `t` brings face `t mod 10` to the front. */
export const drumAngle = (turn: number) => turn * FACE_DEG;
