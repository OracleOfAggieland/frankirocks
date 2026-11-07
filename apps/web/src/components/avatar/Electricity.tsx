"use client";
// Electricity (lab-ui-foundation R9.1, R10.3; Brief 004 item 5): a jagged trunk through its waypoints
// with forking side branches, drawn as a tapered, near-white `spark` core inside two `gold` blooms, a
// tight bright one and a wide faint one. The blooms flicker up briefly each time the bolt regenerates,
// when Frame_Time passes a 60 to 90 ms gap. At most two effects hold a grant from the budget at once;
// one without a grant draws a still crackle near the bolt's ends (the neck bolts), fixed by its seed,
// in faint unblurred layers. Nothing renders under Reduced_Motion. Drawn as SVG inside the avatar's <svg>.
import { useEffect, useState } from "react";
import { type ElectricityBudget, electricityBudget } from "../../ui/electricity-budget";
import { type Bolt, type Point, bolt, crackle, regenGapMs, ribbon, toClosedPath, toPolyline } from "../../ui/electricity";

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

/** The tight bloom's blur. One fixed definition, so repeated ids across bolts are identical. */
export const BOLT_GLOW_FILTER = "franki-bolt-glow";
/** The wide bloom's blur. */
export const BOLT_BLOOM_FILTER = "franki-bolt-bloom";

/** Half widths of the core ribbons: the trunk swells mid-way, branches and twigs taper to a point. */
const CORE = { trunkEnd: 0.4, trunkPeak: 1.05, branchBase: 0.6, branchTip: 0.08, twigBase: 0.38, twigTip: 0.05 } as const;

/**
 * A fixed blur region in user space, far larger than the avatar's 200 by 220 box. Bounding-box units
 * would clip a nearly straight bolt, whose box is almost flat.
 */
const FILTER_REGION = { x: -200, y: -200, width: 600, height: 620 } as const;

/** What gets drawn: one or more trunks (the whole trunk, or a crackle's arms) and the offshoots on them. */
interface Paths {
  trunks: Point[][];
  branches: Point[][];
  twigs: Point[][];
}

function Strokes({ shape, trunk, branch, twig, colour }: { shape: Paths; trunk: number; branch: number; twig: number; colour: string }) {
  const line = { fill: "none", stroke: colour, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <>
      {shape.trunks.map((p, i) => (
        <polyline key={`a${i}`} points={toPolyline(p)} strokeWidth={trunk} {...line} />
      ))}
      {shape.branches.map((p, i) => (
        <polyline key={`b${i}`} data-branch-glow={i} points={toPolyline(p)} strokeWidth={branch} {...line} />
      ))}
      {shape.twigs.map((p, i) => (
        <polyline key={`t${i}`} points={toPolyline(p)} strokeWidth={twig} {...line} />
      ))}
    </>
  );
}

/**
 * The tapered core: filled ribbons. A whole trunk is thickest mid-way; a crackle's arm is thickest at
 * its end of the bolt and runs out to a point; every branch and twig ends in a point.
 */
function Core({ shape, arms = false, opacity, thin = 1 }: { shape: Paths; arms?: boolean; opacity?: number; thin?: number }) {
  const c = (w: number) => w * thin;
  const trunkRibbon = (p: Point[]) =>
    arms ? ribbon(p, c(CORE.branchBase), c(CORE.branchBase), c(CORE.branchTip), 0) : ribbon(p, c(CORE.trunkEnd), c(CORE.trunkPeak), c(CORE.trunkEnd));
  return (
    <g fill="var(--color-spark)" opacity={opacity}>
      {shape.trunks.map((p, i) => (
        <path key={`a${i}`} data-bolt-core="" d={toClosedPath(trunkRibbon(p))} />
      ))}
      {shape.branches.map((p, i) => (
        <path key={`b${i}`} data-branch={i} d={toClosedPath(ribbon(p, c(CORE.branchBase), c(CORE.branchBase), c(CORE.branchTip), 0))} />
      ))}
      {shape.twigs.map((p, i) => (
        <path key={`t${i}`} data-twig={i} d={toClosedPath(ribbon(p, c(CORE.twigBase), c(CORE.twigBase), c(CORE.twigTip), 0))} />
      ))}
    </g>
  );
}

/**
 * Presentational. Granted: the live bolt, its blooms keyed on `flashKey` so a new bolt replays their
 * brief flicker. Not granted: a still crackle of the bolt in `shape`, only near its ends (the neck
 * bolts), in faint layered strokes with no blur or motion, cheap enough for a wall of avatars.
 * `waypoints` gives the leg count for the crackle; without it the bolt counts as one leg.
 */
export function ElectricityView({ waypoints, shape, granted, flashKey = 0 }: { waypoints?: readonly Point[]; shape: Bolt; granted: boolean; flashKey?: number }) {
  if (!granted) {
    const { arms, branches, twigs } = crackle(shape, waypoints ? waypoints.length - 1 : 1);
    const still = { trunks: arms, branches, twigs };
    return (
      <g data-electricity="steady" aria-hidden="true">
        {/* One narrow halo only: a wide unblurred band at low opacity reads as a brown cable casing. */}
        <g opacity={0.22}>
          <Strokes shape={still} trunk={2.4} branch={1.6} twig={1.1} colour="var(--color-gold)" />
        </g>
        <Core shape={still} arms opacity={0.7} thin={0.85} />
      </g>
    );
  }
  const live = { trunks: [shape.trunk], branches: shape.branches, twigs: shape.twigs };
  const region = { filterUnits: "userSpaceOnUse", ...FILTER_REGION } as const;
  return (
    <g data-electricity="bolt" aria-hidden="true">
      <defs>
        <filter id={BOLT_BLOOM_FILTER} {...region}>
          <feGaussianBlur stdDeviation={4.5} />
        </filter>
        <filter id={BOLT_GLOW_FILTER} {...region}>
          <feGaussianBlur stdDeviation={1.2} />
        </filter>
      </defs>
      <g key={flashKey} data-bolt-glow="" className="franki-anim franki-bolt-flash" opacity={0.8}>
        <g data-bolt-bloom="" filter={`url(#${BOLT_BLOOM_FILTER})`} opacity={0.5}>
          <Strokes shape={live} trunk={8} branch={4.5} twig={3} colour="var(--color-gold)" />
        </g>
        <g filter={`url(#${BOLT_GLOW_FILTER})`}>
          <Strokes shape={live} trunk={3.2} branch={2} twig={1.3} colour="var(--color-gold)" />
        </g>
      </g>
      <Core shape={live} />
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

/** The still bolt's seed: fixed by the effect's seed alone, so it never moves with Frame_Time. */
export function steadySeed(seed: number): number {
  return (seed * 7919 + 0x5bd1e995) >>> 0;
}

/** The still bolt drawn without a grant: one level less detail than the live one, so it reads calm. */
export function stillBolt(waypoints: readonly Point[], seed: number, depth: number): Bolt {
  return bolt(waypoints, steadySeed(seed), Math.max(1, depth - 1));
}

export function Electricity({ a, b, via = [], frameTime, reduced, seed = 1, depth = 4, budget = electricityBudget }: ElectricityProps) {
  const granted = useGrant(budget, !reduced);
  if (reduced) return null;
  const waypoints = [a, ...via, b];
  if (!granted) return <ElectricityView waypoints={waypoints} shape={stillBolt(waypoints, seed, depth)} granted={false} />;
  const s = boltSeed(frameTime, seed);
  return <ElectricityView waypoints={waypoints} shape={bolt(waypoints, s, depth)} granted flashKey={s} />;
}
