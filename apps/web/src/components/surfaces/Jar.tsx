"use client";
// The Jar (lab-ui-foundation R16.1, R16.3, R16.12): a glass specimen jar with one mote per memory up to
// a visual cap of 48. Solid for told, dashed for guessed, brass for hard rules, frosted for private.
// Activating it calls `onOpen`. Renders nothing with no motes.
// Brief 004 item 6: rounded shoulders, a short neck, a brass lid with a rim and two rivets, two thin
// highlight streaks on the glass, a faint ecto-tinted fill at the bottom, and a brass label plate
// reading "What I know". Motes drift on spring.float, each on its own small loop (x and y spring
// back and forth out of step); they sit still under Reduced_Motion.
// Brief 015: the glass is shaded like a cylinder, lit along both walls, with a curved meniscus on the
// ecto fill, a faint refraction band and a shadow inside the base. The motes glow (one blurred copy of
// the mote group) and twinkle. The lid is knurled brass; the plate is engraved. Pointed at, the lid
// lifts 2 px and the motes brighten. `arrivingIds` materialize; `leavingIds` dematerialize and stay gone.
import { motion } from "motion/react";
import { type CSSProperties, useId } from "react";
import { COPY } from "../../ui/copy";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { DUR, EASE, SPRING, STAGGER } from "../../ui/motion";
import type { JarProps, MoteKind } from "../../ui/surface-props";
import { FOCUS, TARGET } from "./classes";

export const JAR_CAP = 48;

/** The Jar's props, plus the motes that are arriving or leaving right now. */
export type JarViewProps = JarProps & {
  /** Motes that materialize as they appear. */
  arrivingIds?: readonly string[];
  /** Motes that dematerialize and stay gone; the caller drops them from `motes` afterwards. */
  leavingIds?: readonly string[];
};

const MOTE: Record<MoteKind, { fill: string; stroke: string; dash?: string; opacity: number }> = {
  told: { fill: "var(--color-ecto)", stroke: "var(--color-ecto)", opacity: 0.9 },
  guessed: { fill: "none", stroke: "var(--color-ecto)", dash: "1.5 1.5", opacity: 0.9 },
  rule: { fill: "var(--color-brass)", stroke: "var(--color-brass-hi)", opacity: 1 },
  private: { fill: "var(--color-ghost)", stroke: "var(--color-ink-dim)", opacity: 0.35 },
};

/** The glass: neck, rounded shoulders, straight walls, rounded base. One unit is one CSS pixel. */
export const JAR_GLASS = "M28 21 V27 C28 33 10 33 10 46 V112 Q10 122 20 122 H76 Q86 122 86 112 V46 C86 33 68 33 68 27 V21 Z";

/** The ecto fill: its surface is a meniscus, climbing the two walls; everything below it is fill. */
export const JAR_FILL = "M8 81 Q11 86.5 20 87 H76 Q85 86.5 88 81 V128 H8 Z";

/** The meniscus line alone, drawn faintly over the fill. */
const MENISCUS = "M10 82.5 Q12 86.6 20 87 H76 Q84 86.6 86 82.5";

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

/** Where a mote is in its life: arriving, leaving, or simply there. Leaving wins over arriving. */
export function moteStage(id: string, arrivingIds: readonly string[] = [], leavingIds: readonly string[] = []): "arriving" | "leaving" | "still" {
  if (leavingIds.includes(id)) return "leaving";
  if (arrivingIds.includes(id)) return "arriving";
  return "still";
}

const loopSpring = (delaySeconds: number) => ({ type: "spring" as const, ...SPRING.float, repeat: Infinity, repeatType: "mirror" as const, delay: delaySeconds });
const slotSpring = { type: "spring" as const, ...SPRING.settle };
const fade = { duration: DUR.base / 1000, ease: [...EASE.ecto] as [number, number, number, number] };

/** The knurled grip on the lid's rim: fine vertical lines every 2 px. */
const KNURL = Array.from({ length: 24 }, (_, k) => 25 + k * 2);

/** The drawn motes and their glow; the only part that reads Reduced_Motion. */
function Motes({ motes, arrivingIds, leavingIds }: { motes: JarProps["motes"]; arrivingIds?: readonly string[]; leavingIds?: readonly string[] }) {
  const reduced = useReducedMotion();
  const groupId = `franki-jar-motes-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <>
      {/* The glow: the same motes, blurred, behind the sharp ones. */}
      <use data-jar-glow="" href={`#${groupId}`} filter="url(#franki-jar-mote-glow)" />
      <g id={groupId} data-jar-part="motes" clipPath="url(#franki-jar-glass)">
        {motes.map((m, i) => {
          const s = MOTE[m.kind];
          const { x, y } = motePosition(i);
          const stage = moteStage(m.id, arrivingIds, leavingIds);
          const twinkle = { "--mote-o": s.opacity, "--mote-i": i } as CSSProperties;
          const attrs = { "data-mote": m.kind, r: 2.6, fill: s.fill, stroke: s.stroke, strokeDasharray: s.dash, strokeWidth: 0.8, opacity: s.opacity };
          // Arrive: rise 12 px into place and fade in. Leave: rise 8 px and fade out. A plain fade under Reduced_Motion.
          const presence = reduced
            ? { initial: stage === "arriving" ? { opacity: 0 } : false, animate: { opacity: stage === "leaving" ? 0 : 1 }, transition: fade }
            : {
                initial: stage === "arriving" ? { opacity: 0, y: 12 } : false,
                animate: stage === "leaving" ? { opacity: 0, y: -8 } : { opacity: 1, y: 0 },
                transition: { y: { type: "spring" as const, ...SPRING.settle }, opacity: fade },
              };
          return (
            <motion.g key={m.id} data-mote-stage={stage} {...presence}>
              {reduced ? (
                <circle {...attrs} cx={x} cy={y} data-drift="false" />
              ) : (
                // The slot is a transform, so a mote whose slot changes (one before it was forgotten)
                // settles into the new slot without animating a geometry attribute.
                <motion.g data-mote-slot="" initial={false} animate={{ x, y }} transition={{ x: slotSpring, y: slotSpring }}>
                  <motion.circle
                    {...attrs}
                    cx={0}
                    cy={0}
                    data-drift="true"
                    className="franki-anim franki-mote-twinkle"
                    style={twinkle}
                    initial={{ x: 0, y: 0 }}
                    animate={{ x: moteLoop(i).dx, y: moteLoop(i).dy }}
                    transition={{ x: loopSpring(moteLoop(i).delayX), y: loopSpring(moteLoop(i).delayY) }}
                  />
                </motion.g>
              )}
            </motion.g>
          );
        })}
      </g>
    </>
  );
}

export function Jar({ motes, onOpen, arrivingIds, leavingIds }: JarViewProps) {
  if (motes.length === 0) return null;
  const drawn = motes.slice(0, JAR_CAP);
  return (
    <button type="button" aria-label={COPY.jar.open} data-jar="" onClick={onOpen} className={`${TARGET} ${FOCUS} rounded-control p-1`}>
      <svg viewBox="0 0 96 128" className="h-32 w-24 overflow-visible" aria-hidden="true" focusable="false">
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
          {/* A cylinder of glass: lighter at both walls, where the light runs along it, darker through the middle. */}
          <linearGradient id="franki-jar-body" x1="10" y1="0" x2="86" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--color-ink)" stopOpacity={0.14} />
            <stop offset="12%" stopColor="var(--color-ghost)" stopOpacity={0.05} />
            <stop offset="45%" stopColor="var(--color-night-1)" stopOpacity={0.6} />
            <stop offset="88%" stopColor="var(--color-ghost)" stopOpacity={0.04} />
            <stop offset="100%" stopColor="var(--color-ink)" stopOpacity={0.1} />
          </linearGradient>
          {/* Wall highlights fade out at both ends. */}
          <linearGradient id="franki-jar-streak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-ink)" stopOpacity={0} />
            <stop offset="25%" stopColor="var(--color-ink)" stopOpacity={1} />
            <stop offset="75%" stopColor="var(--color-ink)" stopOpacity={1} />
            <stop offset="100%" stopColor="var(--color-ink)" stopOpacity={0} />
          </linearGradient>
          {/* The refraction band: a faint lighter column right of centre. */}
          <linearGradient id="franki-jar-refraction" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-ink)" stopOpacity={0} />
            <stop offset="50%" stopColor="var(--color-ink)" stopOpacity={0.06} />
            <stop offset="100%" stopColor="var(--color-ink)" stopOpacity={0} />
          </linearGradient>
          <radialGradient id="franki-jar-base-shadow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="var(--color-night-0)" stopOpacity={0.7} />
            <stop offset="100%" stopColor="var(--color-night-0)" stopOpacity={0} />
          </radialGradient>
          {/* A fixed region the size of the drawing, so the blur is never cut short around a single row of motes. */}
          <filter id="franki-jar-mote-glow" filterUnits="userSpaceOnUse" x="0" y="0" width="96" height="128">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>
        <path data-jar-part="glass" d={JAR_GLASS} fill="url(#franki-jar-body)" />
        <path data-jar-part="ecto-fill" d={JAR_FILL} fill="url(#franki-jar-ecto)" clipPath="url(#franki-jar-glass)" />
        <path data-jar-part="meniscus" d={MENISCUS} fill="none" stroke="var(--color-ecto)" strokeOpacity={0.35} strokeWidth={0.7} />
        <rect data-jar-part="refraction" x={54} y={36} width={12} height={86} fill="url(#franki-jar-refraction)" clipPath="url(#franki-jar-glass)" />
        <ellipse data-jar-part="base-shadow" cx={48} cy={119} rx={34} ry={5} fill="url(#franki-jar-base-shadow)" clipPath="url(#franki-jar-glass)" />
        <Motes motes={drawn} arrivingIds={arrivingIds} leavingIds={leavingIds} />
        <g data-jar-part="highlights" fill="url(#franki-jar-streak)">
          <rect x={13.5} y={44} width={2.5} height={56} rx={1.25} opacity={0.28} />
          <rect x={80.5} y={48} width={1.4} height={44} rx={0.7} opacity={0.16} />
        </g>
        {/* The glass's thickness at the base: a faint bright curve just inside the bottom. */}
        <path d="M18 119.5 Q48 121.8 78 119.5" fill="none" stroke="var(--color-ink)" strokeOpacity={0.14} strokeWidth={0.8} strokeLinecap="round" />
        <path data-jar-part="outline" d={JAR_GLASS} fill="none" stroke="var(--color-ink-dim)" strokeWidth={1.4} strokeLinejoin="round" />
        <g data-jar-part="lid">
          <rect x={26} y={5} width={44} height={12} rx={2.5} fill="url(#franki-jar-brass)" />
          {/* The cap's lit top edge and shadowed lower edge. */}
          <line x1={28.5} y1={5.8} x2={67.5} y2={5.8} stroke="var(--color-spark)" strokeOpacity={0.55} strokeWidth={0.7} strokeLinecap="round" />
          <line x1={27} y1={16.4} x2={69} y2={16.4} stroke="var(--color-night-0)" strokeOpacity={0.3} strokeWidth={0.8} />
          <rect data-jar-part="rim" x={22} y={15} width={52} height={6} rx={2} fill="var(--color-brass)" stroke="var(--color-brass-hi)" strokeOpacity={0.7} strokeWidth={0.8} />
          <g data-jar-part="knurl" stroke="var(--color-night-0)" strokeOpacity={0.32} strokeWidth={0.6}>
            {KNURL.map((x) => (
              <line key={x} x1={x} y1={16.4} x2={x} y2={19.6} />
            ))}
          </g>
          <circle data-jar-part="rivet" cx={33} cy={11} r={1.8} fill="var(--color-brass-hi)" stroke="var(--color-brass)" strokeWidth={0.6} />
          <circle data-jar-part="rivet" cx={63} cy={11} r={1.8} fill="var(--color-brass-hi)" stroke="var(--color-brass)" strokeWidth={0.6} />
        </g>
        <g data-jar-part="plate">
          <rect x={11} y={99} width={74} height={17} rx={2} fill="url(#franki-jar-brass)" stroke="var(--color-brass-hi)" strokeOpacity={0.6} strokeWidth={0.8} />
          <rect x={13} y={101} width={70} height={13} rx={1.2} fill="none" stroke="var(--color-night-0)" strokeOpacity={0.22} strokeWidth={0.6} />
          <text x={48} y={112.3} textAnchor="middle" aria-hidden="true" className="fill-spark font-sans text-xs" opacity={0.4}>
            {COPY.jar.open}
          </text>
          <text x={48} y={111.5} textAnchor="middle" className="fill-night-0 font-sans text-xs">
            {COPY.jar.open}
          </text>
        </g>
      </svg>
    </button>
  );
}
