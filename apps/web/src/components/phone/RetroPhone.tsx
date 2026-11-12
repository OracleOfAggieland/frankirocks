"use client";
// The phone on Franki's wall: a wooden wall telephone with two brass bells, a rotary dial, a crank and a handset
// on a hook, drawn in code. It hangs beside Franki only while a phone call is out, and its parts act the call:
//   dialing   the handset floats off its hook toward Franki and the dial wheel winds and returns
//   ringing   the bells shake in bursts, the clapper beats between them, ring marks flick above
//   talking   the bells rest and three small waves pulse at the earpiece
//   ended     the handset goes back on the hook and the bells give one last ding
//   missed    the handset goes back on the hook and the dial's cap glows ember
// The loops are CSS (phone.css) and stop under Reduced_Motion and while the tab is hidden; the handset and the
// cord move on spring.settle through motion, which jumps instead under Reduced_Motion. The words under the phone
// say the same thing the drawing does, so nothing depends on the motion.
import { AnimatePresence, motion } from "motion/react";
import { useId } from "react";
import { COPY } from "../../ui/copy";
import { DUR, EASE, SPRING } from "../../ui/motion";
import type { MissReason, PhonePhase, PhoneView } from "../../ui/phone/phone-call";

type ShownPhase = Exclude<PhonePhase, "absent">;

/** The handset is off its hook while Franki holds the line. */
export function handsetLifted(phase: PhonePhase): boolean {
  return phase === "dialing" || phase === "ringing" || phase === "talking";
}

export function phoneCaption(phase: ShownPhase, reason: MissReason | null): string {
  if (phase === "missed") return COPY.phone.missed[reason ?? "failed"];
  return COPY.phone[phase];
}

/** The handset's pose in drawing units: on the hook, or floated out toward Franki and tipped to his ear. */
export const HANDSET_POSE = {
  hook: { x: 0, y: 0, rotate: 0 },
  lifted: { x: -20, y: 10, rotate: -26 },
} as const;

/** The cord from the handset's foot to the cabinet, for each pose. Same commands in both, so it can be tweened. */
export const CORD_PATH = {
  hook: "M 26 132 C 24 168, 40 178, 52 166",
  lifted: "M 20 150 C 10 186, 38 192, 52 166",
} as const;

const TEN = Array.from({ length: 10 }, (_, i) => i);

/** Ten finger holes on the wheel, from one o'clock clockwise, leaving the gap at the finger stop. */
export function fingerHole(i: number): { cx: number; cy: number } {
  const angle = ((-60 + i * 30) * Math.PI) / 180;
  return { cx: 94 + 14.5 * Math.cos(angle), cy: 88 + 14.5 * Math.sin(angle) };
}

function Bell({ cx, fill, ringing, ding }: { cx: number; fill: string; ringing: boolean; ding: boolean }) {
  const act = ringing ? " franki-anim phone-bell-ring" : ding ? " franki-anim phone-bell-ding" : "";
  return (
    <g data-phone-part="bell" className={`phone-origin${act}`}>
      <circle cx={cx} cy={36} r={13} fill={fill} className="phone-brass-edge" />
      <ellipse cx={cx - 4} cy={31} rx={4.5} ry={3} className="phone-glint" />
      <circle cx={cx} cy={36} r={2.6} className="phone-brass-nut" />
    </g>
  );
}

function Handset({ phase, brass, wood }: { phase: ShownPhase; brass: string; wood: string }) {
  const lifted = handsetLifted(phase);
  return (
    <motion.g
      data-phone-part="handset"
      data-lifted={lifted ? "true" : "false"}
      initial={false}
      animate={lifted ? HANDSET_POSE.lifted : HANDSET_POSE.hook}
      transition={{ type: "spring", ...SPRING.settle }}
    >
      {/* The earpiece: a brass cup facing Franki. */}
      <path d="M 15 36 Q 26 26 37 36 L 34 47 H 18 Z" fill={brass} className="phone-brass-edge" />
      <ellipse cx={26} cy={35} rx={10.5} ry={3.6} className="phone-brass-nut" />
      {/* The grip: turned wood, two beads and a waist. */}
      <path
        d="M 21 47 H 31 C 33 56 31 60 31 64 C 34 72 34 86 31 94 C 31 98 33 102 31 111 H 21 C 19 102 21 98 21 94 C 18 86 18 72 21 64 C 21 60 19 56 21 47 Z"
        fill={wood}
        className="phone-wood-edge"
      />
      <path d="M 24 66 C 22.5 74 22.5 84 24 92" className="phone-grain" />
      {/* The mouthpiece: a brass ball. */}
      <circle cx={26} cy={121} r={9.5} fill={brass} className="phone-brass-edge" />
      <ellipse cx={22.5} cy={117.5} rx={3} ry={2.2} className="phone-glint" />
      {/* Franki's side of the conversation: three waves at the earpiece, only while talking. */}
      {phase === "talking" ? (
        <g data-phone-part="waves" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d={`M ${20 - i * 5} ${24 - i * 3} Q 26 ${17 - i * 5} ${32 + i * 5} ${24 - i * 3}`}
              className={`phone-wave franki-anim phone-wave-${i}`}
            />
          ))}
        </g>
      ) : null}
    </motion.g>
  );
}

/** The drawing alone: 160 by 240 units, the handset's hook on the left, toward Franki. */
export function RetroPhone({ view }: { view: PhoneView }) {
  const uid = useId().replace(/:/g, "");
  const ids = { brass: `phone-brass-${uid}`, wood: `phone-wood-${uid}`, panel: `phone-panel-${uid}` };
  if (view.phase === "absent") return null;
  const phase = view.phase;
  const brass = `url(#${ids.brass})`;
  const ringing = phase === "ringing";
  const lifted = handsetLifted(phase);
  return (
    <svg viewBox="0 0 160 240" overflow="visible" className="block h-auto w-full" aria-hidden="true" focusable="false" data-phone-phase={phase}>
      <defs>
        <radialGradient id={ids.brass} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="var(--color-brass-hi)" />
          <stop offset="55%" stopColor="var(--color-brass)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--color-brass) 42%, var(--color-night-0))" />
        </radialGradient>
        <linearGradient id={ids.wood} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--color-brass) 16%, var(--color-night-0))" />
          <stop offset="45%" stopColor="color-mix(in srgb, var(--color-brass) 34%, var(--color-night-2))" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--color-brass) 18%, var(--color-night-0))" />
        </linearGradient>
        <linearGradient id={ids.panel} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--color-brass) 30%, var(--color-night-2))" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--color-brass) 14%, var(--color-night-0))" />
        </linearGradient>
      </defs>

      {/* The backboard and the cabinet on it. */}
      <rect x={44} y={8} width={100} height={224} rx={6} fill={`url(#${ids.wood})`} className="phone-wood-edge" />
      <rect x={50} y={14} width={88} height={122} rx={4} fill={`url(#${ids.panel})`} className="phone-wood-edge" />
      <rect x={55} y={19} width={78} height={112} rx={2.5} className="phone-inlay" />
      <path d="M 60 60 H 128 M 60 118 H 128" className="phone-grain" />

      {/* The bells, the plate between them and the clapper. */}
      <path d="M 88 26 Q 94 30 100 26 L 98 50 Q 94 46 90 50 Z" fill={brass} className="phone-brass-edge" />
      <g data-phone-part="clapper" className={`phone-origin${ringing ? " franki-anim phone-clapper" : ""}`}>
        <path d="M 94 52 V 40" className="phone-clapper-arm" />
        <circle cx={94} cy={38} r={2.4} className="phone-brass-nut" />
      </g>
      <Bell cx={76} fill={brass} ringing={ringing} ding={phase === "ended"} />
      <Bell cx={112} fill={brass} ringing={ringing} ding={phase === "ended"} />
      {ringing ? (
        <g data-phone-part="ring-marks" className="franki-anim phone-ring-marks" aria-hidden="true">
          <path d="M 60 20 L 55 13 M 68 14 L 66 6 M 120 14 L 122 6 M 128 20 L 133 13 M 94 12 V 4" className="phone-ring-mark" />
        </g>
      ) : null}

      {/* The dial: a chased brass ring, the finger wheel, and its cap. The wheel winds only while dialing. */}
      <circle cx={94} cy={88} r={27} fill={brass} className="phone-brass-edge" />
      <circle cx={94} cy={88} r={23.5} className="phone-chasing" />
      <circle cx={94} cy={88} r={20} className="phone-dial-well" />
      <g data-phone-part="wheel" className={`phone-origin${phase === "dialing" ? " franki-anim phone-dial-spin" : ""}`}>
        <circle cx={94} cy={88} r={18.5} className="phone-wheel" />
        {TEN.map((i) => {
          const { cx, cy } = fingerHole(i);
          return <circle key={i} cx={cx} cy={cy} r={2.7} className="phone-hole" />;
        })}
      </g>
      <path d="M 106 103 L 111 109" className="phone-stop" />
      <circle cx={94} cy={88} r={6.5} fill={brass} className="phone-brass-edge" />
      <circle cx={94} cy={88} r={3} data-phone-part="lamp" className={phase === "missed" ? "phone-lamp-missed" : lifted ? "phone-lamp-live" : "phone-lamp"} />

      {/* The crank on the right side. */}
      <path d="M 144 84 H 152 V 96" className="phone-crank" />
      <circle cx={152} cy={99} r={4} fill={brass} className="phone-brass-edge" />

      {/* The rail, and the writing shelf under it. */}
      <rect x={46} y={138} width={96} height={11} rx={2} fill={`url(#${ids.wood})`} className="phone-wood-edge" />
      <path d="M 54 156 H 134 V 190 Q 134 222 94 222 Q 54 222 54 190 Z" fill={`url(#${ids.panel})`} className="phone-wood-edge" />
      <path d="M 60 162 H 128 V 189 Q 128 215 94 215 Q 60 215 60 189 Z" className="phone-inlay" />
      <path d="M 50 196 Q 94 244 138 196" className="phone-shelf-lip" />

      {/* The hook the handset hangs on, then the cord, then the handset over both. */}
      <path d="M 50 42 H 34 Q 30 42 30 38" className="phone-hook" />
      <motion.path
        data-phone-part="cord"
        initial={false}
        animate={{ d: lifted ? CORD_PATH.lifted : CORD_PATH.hook }}
        transition={{ type: "spring", ...SPRING.settle }}
        className="phone-cord"
      />
      <motion.path
        initial={false}
        animate={{ d: lifted ? CORD_PATH.lifted : CORD_PATH.hook }}
        transition={{ type: "spring", ...SPRING.settle }}
        className="phone-cord-coil"
      />
      <Handset phase={phase} brass={brass} wood={`url(#${ids.wood})`} />
    </svg>
  );
}

/** Where the phone hangs on the stage: beside Franki's right shoulder, smaller and closer in on a narrow screen. */
export const PHONE_PLACE = "pointer-events-none absolute left-[84%] top-[0%] w-[48%] max-sm:left-[78%] max-sm:top-[8%] max-sm:w-[34%]";

/**
 * The phone in its place, with its words. It materializes when a call starts and fades when the call is over;
 * the drawing that leaves is the last one shown. Rendered inside the Stage, which is the positioning box.
 */
export function PhoneOnStage({ view }: { view: PhoneView }) {
  return (
    <AnimatePresence>
      {view.phase === "absent" ? null : (
        <motion.div
          key="phone"
          data-phone=""
          role="img"
          aria-label={COPY.phone.label[view.phase]}
          className={`${PHONE_PLACE} flex flex-col items-center gap-2`}
          initial={{ opacity: 0, y: 10, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: DUR.base / 1000, ease: EASE.ecto }}
        >
          <RetroPhone view={view} />
          <span data-phone-caption="" className="whitespace-nowrap font-mono text-xs text-ink-dim">
            {phoneCaption(view.phase, view.reason)}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
