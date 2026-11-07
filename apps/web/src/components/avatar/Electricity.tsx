"use client";
// Electricity (lab-ui-foundation R9.1, R10.3): a jagged bolt between two points, stroked `spark` with a
// `gold` glow, regenerated when Frame_Time passes a 60 to 90 ms gap. At most two effects hold a grant
// from the budget at once; one without a grant draws a steady glow. Nothing renders under
// Reduced_Motion. Drawn as SVG inside the avatar's <svg>.
import { useEffect, useState } from "react";
import { type ElectricityBudget, electricityBudget } from "../../ui/electricity-budget";
import { type Point, boltPath, regenGapMs, toPolyline } from "../../ui/electricity";

export interface ElectricityProps {
  a: Point;
  b: Point;
  /** The latest Frame_Time; the bolt regenerates when it passes the gap. */
  frameTime: number;
  reduced: boolean;
  /** Starting seed, so two effects differ. */
  seed?: number;
  depth?: number;
  budget?: ElectricityBudget;
}

/** Presentational: a bolt when granted, else a steady glow along the line. */
export function ElectricityView({ a, b, points, granted }: { a: Point; b: Point; points: readonly Point[]; granted: boolean }) {
  if (!granted) {
    return (
      <g data-electricity="steady" aria-hidden="true">
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-gold)" strokeOpacity={0.35} strokeWidth={3} strokeLinecap="round" />
      </g>
    );
  }
  const line = toPolyline(points);
  return (
    <g data-electricity="bolt" aria-hidden="true">
      <polyline points={line} fill="none" stroke="var(--color-gold)" strokeOpacity={0.45} strokeWidth={4} strokeLinejoin="round" filter="url(#franki-glow)" />
      <polyline points={line} fill="none" stroke="var(--color-spark)" strokeWidth={1.4} strokeLinejoin="round" />
    </g>
  );
}

/** Holds one budget grant while mounted and not reduced; releases it on unmount. */
function useGrant(budget: ElectricityBudget, wanted: boolean): boolean {
  const [token, setToken] = useState<number | null>(null);
  useEffect(() => {
    if (!wanted) return;
    const t = budget.request();
    let live = true;
    // Told after the commit, as an external system would, so the effect body never sets state.
    void Promise.resolve().then(() => {
      if (live) setToken(t);
    });
    return () => {
      live = false;
      if (t !== null) budget.release(t);
      setToken(null);
    };
  }, [budget, wanted]);
  return token !== null;
}

/** Frame_Time is cut into 150 ms windows, each split at 60 to 90 ms, so every bolt lasts 60 to 90 ms. */
const WINDOW_MS = 150;

/** The bolt's seed at a Frame_Time: it changes after each 60 to 90 ms stretch. */
export function boltSeed(frameTime: number, seed: number): number {
  const t = Number.isFinite(frameTime) && frameTime > 0 ? frameTime : 0;
  const w = Math.floor(t / WINDOW_MS);
  const split = regenGapMs((seed * 7919 + w) >>> 0);
  const half = t - w * WINDOW_MS >= split ? 1 : 0;
  return (seed * 7919 + w * 2 + half) >>> 0;
}

export function Electricity({ a, b, frameTime, reduced, seed = 1, depth = 4, budget = electricityBudget }: ElectricityProps) {
  const granted = useGrant(budget, !reduced);
  if (reduced) return null;
  return <ElectricityView a={a} b={b} points={boltPath(a, b, boltSeed(frameTime, seed), depth)} granted={granted} />;
}
