// The Jar (lab-ui-foundation R16.1, R16.3, R16.12): a glass specimen jar with one mote per memory up to
// a visual cap of 48. Solid for told, dashed for guessed, brass for hard rules, frosted for private.
// Activating it calls `onOpen`. Renders nothing with no motes.
import { COPY } from "../../ui/copy";
import type { JarProps, MoteKind } from "../../ui/surface-props";
import { FOCUS, TARGET } from "./classes";

export const JAR_CAP = 48;

const MOTE: Record<MoteKind, { fill: string; stroke: string; dash?: string; opacity: number }> = {
  told: { fill: "var(--color-ecto)", stroke: "var(--color-ecto)", opacity: 0.9 },
  guessed: { fill: "none", stroke: "var(--color-ecto)", dash: "1.5 1.5", opacity: 0.9 },
  rule: { fill: "var(--color-brass)", stroke: "var(--color-brass-hi)", opacity: 1 },
  private: { fill: "var(--color-ghost)", stroke: "var(--color-ink-dim)", opacity: 0.35 },
};

/** A fixed, even spread of mote positions inside the jar body. */
function motePosition(i: number): { x: number; y: number } {
  const col = i % 6;
  const row = Math.floor(i / 6);
  return { x: 14 + col * 7 + (row % 2) * 3.5, y: 82 - row * 7 };
}

export function Jar({ motes, onOpen }: JarProps) {
  if (motes.length === 0) return null;
  const drawn = motes.slice(0, JAR_CAP);
  return (
    <button type="button" aria-label={COPY.jar.open} data-jar="" onClick={onOpen} className={`${TARGET} ${FOCUS} rounded-control p-1`}>
      <svg viewBox="0 0 72 96" className="h-24 w-[72px]" aria-hidden="true" focusable="false">
        <rect x="18" y="4" width="36" height="8" rx="2" fill="var(--color-brass)" />
        <path d="M14 14 H58 Q66 20 66 32 V84 Q66 92 58 92 H14 Q6 92 6 84 V32 Q6 20 14 14 Z" fill="var(--color-night-1)" fillOpacity={0.6} stroke="var(--color-ink-dim)" strokeWidth={1.5} />
        {drawn.map((m, i) => {
          const s = MOTE[m.kind];
          const { x, y } = motePosition(i);
          return <circle key={m.id} data-mote={m.kind} cx={x} cy={y} r={2.6} fill={s.fill} stroke={s.stroke} strokeDasharray={s.dash} strokeWidth={0.8} opacity={s.opacity} />;
        })}
      </svg>
    </button>
  );
}
