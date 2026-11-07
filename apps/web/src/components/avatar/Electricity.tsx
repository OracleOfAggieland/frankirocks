"use client";
// Electricity (lab-ui-foundation R9.1, R10.3; Brief 004 item 5): a jagged bolt through its waypoints
// with one or two short side branches, drawn as a bright `spark` core over a wider, blurred `gold`
// glow. The glow flashes briefly each time the bolt regenerates, when Frame_Time passes a 60 to 90 ms
// gap. At most two effects hold a grant from the budget at once; one without a grant draws a steady
// glow along the waypoints. Nothing renders under Reduced_Motion. Drawn as SVG inside the avatar's <svg>.
import { useEffect, useState } from "react";
import { type ElectricityBudget, electricityBudget } from "../../ui/electricity-budget";
import { type Bolt, type Point, bolt, regenGapMs, toPolyline } from "../../ui/electricity";

export interface ElectricityProps {
  a: Point;
  b: Point;
  /** Waypoints between a and b, so a bolt can arc (over the head) or come down around the face. */
  via?: readonly Point[];
  /** The latest Frame_Time; the bolt regenerates when it passes the gap. */
  frameTime: number;
  reduced: boolean;
  /** Starting seed, so two effects differ. */
  seed?: number;
  depth?: number;
  budget?: ElectricityBudget;
}

/** The glow's blur. One fixed definition, so repeated ids across bolts are identical. */
export const BOLT_GLOW_FILTER = "franki-bolt-glow";

/** Presentational: a bolt when granted, else a steady glow along the waypoints. `flashKey` restarts the glow's flash. */
export function ElectricityView({ waypoints, shape, granted, flashKey = 0 }: { waypoints: readonly Point[]; shape: Bolt; granted: boolean; flashKey?: number }) {
  if (!granted) {
    return (
      <g data-electricity="steady" aria-hidden="true">
        <polyline points={toPolyline(waypoints)} fill="none" stroke="var(--color-gold)" strokeOpacity={0.35} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  const trunk = toPolyline(shape.trunk);
  const branches = shape.branches.map(toPolyline);
  return (
    <g data-electricity="bolt" aria-hidden="true">
      <defs>
        <filter id={BOLT_GLOW_FILTER} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={2.4} />
        </filter>
      </defs>
      {/* Keyed on the bolt's seed: a new bolt remounts the glow and replays its brief flash. */}
      <g key={flashKey} data-bolt-glow="" className="franki-anim franki-bolt-flash" opacity={0.6} filter={`url(#${BOLT_GLOW_FILTER})`}>
        <polyline points={trunk} fill="none" stroke="var(--color-gold)" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        {branches.map((p, i) => (
          <polyline key={i} data-branch-glow={i} points={p} fill="none" stroke="var(--color-gold)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </g>
      <polyline data-bolt-core="" points={trunk} fill="none" stroke="var(--color-spark)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      {branches.map((p, i) => (
        <polyline key={i} data-branch={i} points={p} fill="none" stroke="var(--color-spark)" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
      ))}
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

export function Electricity({ a, b, via = [], frameTime, reduced, seed = 1, depth = 4, budget = electricityBudget }: ElectricityProps) {
  const granted = useGrant(budget, !reduced);
  if (reduced) return null;
  const waypoints = [a, ...via, b];
  const s = boltSeed(frameTime, seed);
  return <ElectricityView waypoints={waypoints} shape={bolt(waypoints, s, depth)} granted={granted} flashKey={s} />;
}
