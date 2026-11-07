"use client";
// The Jar (lab-ui-foundation R16.1, R16.3, R16.12): a glass specimen jar with one mote per memory up to
// a visual cap of 48. Solid for told, dashed for guessed, brass for hard rules, frosted for private.
// Activating it calls `onOpen`. Renders nothing with no motes.
// Brief 004 item 6: rounded shoulders, a short neck, a brass lid with a rim and two rivets, two thin
// highlight streaks on the glass, a faint ecto-tinted fill at the bottom, and a brass label plate
// reading "What I know". Motes drift on spring.float, each on its own small loop (x and y spring
// back and forth out of step); they sit still under Reduced_Motion. Only transforms move.
import { motion } from "motion/react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { SPRING, STAGGER } from "../../ui/motion";
import type { JarProps, MoteKind } from "../../ui/surface-props";
import { FOCUS, TARGET } from "./classes";

export const JAR_CAP = 48;

const MOTE: Record<MoteKind, { fill: string; stroke: string; dash?: string; opacity: number }> = {
  told: { fill: "var(--color-ecto)", stroke: "var(--color-ecto)", opacity: 0.9 },
  guessed: { fill: "none", stroke: "var(--color-ecto)", dash: "1.5 1.5", opacity: 0.9 },
  rule: { fill: "var(--color-brass)", stroke: "var(--color-brass-hi)", opacity: 1 },
  private: { fill: "var(--color-ghost)", stroke: "var(--color-ink-dim)", opacity: 0.35 },
};

/** The glass: neck, rounded shoulders, straight walls, rounded base. One unit is one CSS pixel. */
export const JAR_GLASS = "M28 21 V27 C28 33 10 33 10 46 V112 Q10 122 20 122 H76 Q86 122 86 112 V46 C86 33 68 33 68 27 V21 Z";

const COLS = 8;

/** A fixed, even spread of mote positions in the glass above the label plate, filling from the bottom. */
export function motePosition(i: number): { x: number; y: number } {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return { x: 17 + col * 8.6 + (row % 2) * 2.5, y: 90 - row * 9 };
}

/** Each mote's own small loop: an x and a y offset, out of step, so the two springs trace a loop. */
export function moteLoop(i: number): { dx: number; dy: number; delayX: number; delayY: number } {
  const sx = i % 2 === 0 ? 1 : -1;
  const sy = i % 3 === 0 ? -1 : 1;
  const delayX = (((i * 7) % 11) * STAGGER) / 1000;
  return {
    dx: sx * (1 + ((i * 37) % 5) * 0.3),
    dy: sy * (1.2 + ((i * 53) % 4) * 0.35),
    delayX,
    // Always later than x, by a different step per mote, so the two springs stay out of step.
    delayY: delayX + ((1 + (i % 4)) * STAGGER * 3) / 1000,
  };
}

const loopSpring = (delaySeconds: number) => ({ type: "spring" as const, ...SPRING.float, repeat: Infinity, repeatType: "mirror" as const, delay: delaySeconds });

/** The drawn motes; the only part that reads Reduced_Motion. */
function Motes({ motes }: { motes: JarProps["motes"] }) {
  const reduced = useReducedMotion();
  return (
    <g data-jar-part="motes" clipPath="url(#franki-jar-glass)">
      {motes.map((m, i) => {
        const s = MOTE[m.kind];
        const { x, y } = motePosition(i);
        const attrs = { "data-mote": m.kind, cx: x, cy: y, r: 2.6, fill: s.fill, stroke: s.stroke, strokeDasharray: s.dash, strokeWidth: 0.8, opacity: s.opacity };
        if (reduced) return <circle key={m.id} {...attrs} data-drift="false" />;
        const loop = moteLoop(i);
        return (
          <motion.circle
            key={m.id}
            {...attrs}
            data-drift="true"
            initial={{ x: 0, y: 0 }}
            animate={{ x: loop.dx, y: loop.dy }}
            transition={{ x: loopSpring(loop.delayX), y: loopSpring(loop.delayY) }}
          />
        );
      })}
    </g>
  );
}

export function Jar({ motes, onOpen }: JarProps) {
  if (motes.length === 0) return null;
  const drawn = motes.slice(0, JAR_CAP);
  return (
    <button type="button" aria-label={COPY.jar.open} data-jar="" onClick={onOpen} className={`${TARGET} ${FOCUS} rounded-control p-1`}>
      <svg viewBox="0 0 96 128" className="h-32 w-24" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="franki-jar-glass">
            <path d={JAR_GLASS} />
          </clipPath>
          <linearGradient id="franki-jar-ecto" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-ecto)" stopOpacity={0} />
            <stop offset="100%" stopColor="var(--color-ecto)" stopOpacity={0.28} />
          </linearGradient>
          <linearGradient id="franki-jar-brass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brass-hi)" />
            <stop offset="100%" stopColor="var(--color-brass)" />
          </linearGradient>
        </defs>
        <path data-jar-part="glass" d={JAR_GLASS} fill="var(--color-night-1)" fillOpacity={0.55} />
        <rect data-jar-part="ecto-fill" x={0} y={86} width={96} height={42} fill="url(#franki-jar-ecto)" clipPath="url(#franki-jar-glass)" />
        <Motes motes={drawn} />
        <g data-jar-part="highlights" fill="var(--color-ink)">
          <rect x={16} y={50} width={2.5} height={46} rx={1.25} opacity={0.16} />
          <rect x={22} y={56} width={1.2} height={24} rx={0.6} opacity={0.1} />
        </g>
        <path data-jar-part="outline" d={JAR_GLASS} fill="none" stroke="var(--color-ink-dim)" strokeWidth={1.4} strokeLinejoin="round" />
        <g data-jar-part="lid">
          <rect x={26} y={5} width={44} height={12} rx={2.5} fill="url(#franki-jar-brass)" />
          <rect data-jar-part="rim" x={22} y={15} width={52} height={6} rx={2} fill="var(--color-brass)" stroke="var(--color-brass-hi)" strokeOpacity={0.7} strokeWidth={0.8} />
          <circle data-jar-part="rivet" cx={33} cy={11} r={1.8} fill="var(--color-brass-hi)" stroke="var(--color-brass)" strokeWidth={0.6} />
          <circle data-jar-part="rivet" cx={63} cy={11} r={1.8} fill="var(--color-brass-hi)" stroke="var(--color-brass)" strokeWidth={0.6} />
        </g>
        <g data-jar-part="plate">
          <rect x={11} y={99} width={74} height={17} rx={2} fill="url(#franki-jar-brass)" stroke="var(--color-brass-hi)" strokeOpacity={0.6} strokeWidth={0.8} />
          <text x={48} y={111.5} textAnchor="middle" className="fill-night-0 font-sans text-xs">
            {COPY.jar.open}
          </text>
        </g>
      </svg>
    </button>
  );
}
