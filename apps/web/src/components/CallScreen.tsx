"use client";
// The call controls (lab-ui-foundation R10.4, R14.4 to R14.6, R18.1 to R18.3; keeps FSC R16.4 to R16.6,
// R13.8, R15.8). Exactly one call button whose start and hang-up forms differ in shape and colour:
// start is a round brass ring around a power glyph with an ecto core; hang-up is a squared ember form.
// Each sits in a knurled brass bezel (round or squared) that turns slowly on hover and focus; disabled, the
// bezel dims and the start core goes dark. The mute toggle shows only while listening, thinking or speaking,
// in its own column so the call button never moves off Franki's axis. Errors and Retry stay inline, in mono 12.
//
// The power button (Nov 13): the start form sits on a dial plate with engraved ticks, four rivets and a pilot
// lamp, in an ecto aura that breathes with Franki's float. Its core is a glass bulb with plasma turning inside
// and a bolt for the glyph's upright. Hover or keyboard focus brightens the core and runs a charge around the
// dial; a press adds a flash, a shockwave and a comet's tail to the ring spark. A live call's squared form
// arrives with one ember ring and keeps an ember aura. The motion lives in screen/power.css.
import { type VoiceState, callButton, muteVisible } from "@franki/core";
import { motion } from "motion/react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { COPY } from "../ui/copy";
import { type ElectricityBudget, electricityBudget } from "../ui/electricity-budget";
import { useReducedMotion } from "../ui/hooks/reduced-motion";
import { SPRING } from "../ui/motion";
import { RING_SPARK_IDLE, type RingSpark, type RingSparkEvent, ringSparkPropEvents, ringSparkStep } from "../ui/ring-spark";
import { FOCUS, TARGET } from "./surfaces/classes";

/** A brass-outlined quiet control: something you can touch, secondary to the call button. */
const RETRY_BUTTON = `${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control border border-brass px-4 text-base text-brass-hi transition-colors duration-(--dur-quick) hover:bg-brass/15`;

/** The inline message for each failed step; the strings live in COPY.call.errors. */
export const CALL_ERRORS: Record<NonNullable<VoiceState["error"]>, string> = COPY.call.errors;

export interface CallScreenProps {
  voice: VoiceState;
  /** False while signed out or before Firebase reports (R9.4): the call button shows disabled. */
  enabled: boolean;
  /** Set when the transcription model is not configured, so a call cannot be set up. */
  configMissing?: string | null;
  onCall: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onRetry: () => void;
}

/**
 * The power glyph, with a lightning bolt for its upright stroke. Lit, it is etched into the glowing glass: dark
 * strokes with a thin lit edge under them. Dark, it is the cold filament of an unlit bulb.
 */
function PowerGlyph({ lit }: { lit: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-power-glyph={lit ? "lit" : "dark"}
      className="relative h-[26px] w-[26px]"
      style={lit ? GLYPH_ETCH : undefined}
    >
      <path d="M6.9 7.4 A7.7 7.7 0 1 0 17.1 7.4" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M13.3 2.2 L9.3 8.5 H11.9 L10.7 13.2 L14.7 6.8 H12.1 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" />
    </svg>
  );
}

/*
 * The dial plate behind the knurled bezel, in a 120 px box (16 px past the bezel's 88 px on every side): a dark
 * gunmetal ring from 45.5 to 55 px with engraved brass ticks every 6 degrees, a long one every 30, four brass
 * rivets on the diagonals and a pilot lamp at twelve o'clock that glows while the button can be pressed.
 */
const DIAL = { box: 120, inner: 45.5, outer: 55, rivet: 50.25 } as const;
const RIVET_ANGLES = [45, 135, 225, 315] as const;
const at = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: +(DIAL.box / 2 + r * Math.sin(a)).toFixed(2), y: +(DIAL.box / 2 - r * Math.cos(a)).toFixed(2) };
};
/** Every 6 degrees, leaving room for the pilot lamp at 0 and the rivets on the diagonals. */
const DIAL_TICKS = Array.from({ length: 60 }, (_, i) => i * 6).filter((deg) => deg !== 0 && RIVET_ANGLES.every((r) => Math.abs(deg - r) > 4));

function DialTicks({ stroke, opacity }: { stroke: string; opacity: (major: boolean) => number }) {
  return (
    <g stroke={stroke} strokeLinecap="round">
      {DIAL_TICKS.map((deg) => {
        const major = deg % 30 === 0;
        const a = at(deg, major ? 47.6 : 49.2);
        const b = at(deg, major ? 53 : 52);
        return <line key={deg} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={major ? 1.1 : 0.75} strokeOpacity={opacity(major)} />;
      })}
    </g>
  );
}

function Dial({ lit }: { lit: boolean }) {
  const uid = useId();
  const plate = defId(uid, "dial-plate");
  const rivet = defId(uid, "dial-rivet");
  const c = DIAL.box / 2;
  const mid = (DIAL.inner + DIAL.outer) / 2;
  const lamp = at(0, DIAL.rivet);
  return (
    <svg aria-hidden="true" focusable="false" data-power-dial-plate="" viewBox={`0 0 ${DIAL.box} ${DIAL.box}`} className="absolute inset-0 h-full w-full overflow-visible">
      <defs>
        <linearGradient id={plate} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="color-mix(in srgb, var(--color-brass) 16%, var(--color-night-2))" />
          <stop offset="0.55" stopColor="var(--color-night-1)" />
          <stop offset="1" stopColor="var(--color-night-0)" />
        </linearGradient>
        <radialGradient id={rivet} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="var(--color-spark)" />
          <stop offset="0.35" stopColor="var(--color-brass-hi)" />
          <stop offset="1" stopColor="color-mix(in srgb, var(--color-brass) 45%, var(--color-night-0))" />
        </radialGradient>
      </defs>
      {/* The plate, its lit outer lip and the dark seam where it meets the bezel. */}
      <circle cx={c} cy={c} r={mid} fill="none" stroke={`url(#${plate})`} strokeWidth={DIAL.outer - DIAL.inner} />
      <circle cx={c} cy={c} r={DIAL.outer - 0.3} fill="none" stroke="var(--color-brass)" strokeOpacity="0.4" strokeWidth="0.6" />
      <circle cx={c} cy={c} r={DIAL.inner + 0.3} fill="none" stroke="var(--color-night-0)" strokeOpacity="0.9" strokeWidth="0.8" />
      <DialTicks stroke="var(--color-brass)" opacity={(major) => (major ? 0.7 : 0.38)} />
      {RIVET_ANGLES.map((deg) => {
        const p = at(deg, DIAL.rivet);
        return (
          <g key={deg}>
            <circle cx={p.x} cy={p.y + 0.5} r="2.1" fill="var(--color-night-0)" fillOpacity="0.7" />
            <circle cx={p.x} cy={p.y} r="1.9" fill={`url(#${rivet})`} />
          </g>
        );
      })}
      {/* The pilot lamp: lit ecto with a soft halo that breathes with the aura, or a cold dark bead. */}
      {lit ? (
        <>
          <circle data-power-pilot="" className="franki-anim" cx={lamp.x} cy={lamp.y} r="4.2" fill="var(--color-ecto)" fillOpacity="0.28" />
          <circle cx={lamp.x} cy={lamp.y} r="2.1" fill="var(--color-ecto)" />
          <circle cx={lamp.x - 0.6} cy={lamp.y - 0.7} r="0.7" fill="var(--color-spark)" fillOpacity="0.9" />
        </>
      ) : (
        <circle cx={lamp.x} cy={lamp.y} r="2.1" fill="var(--color-night-0)" stroke="var(--color-stitch)" strokeWidth="0.6" />
      )}
    </svg>
  );
}

/**
 * The charge that runs around the dial on hover and keyboard focus: the same ticks in ecto, seen through a
 * comet-shaped conic mask that turns while the ticks under it turn back, so the ticks hold still and only the
 * light moves. Both turns are transforms; power.css runs them only with motion allowed.
 */
function DialCharge() {
  return (
    <span aria-hidden="true" data-power-chase="" className="pointer-events-none absolute -inset-4">
      <span data-power-chase-light="" className="franki-anim absolute inset-0">
        <svg aria-hidden="true" focusable="false" data-power-chase-ticks="" viewBox={`0 0 ${DIAL.box} ${DIAL.box}`} className="franki-anim absolute inset-0 h-full w-full overflow-visible">
          <DialTicks stroke="var(--color-ecto)" opacity={() => 1} />
        </svg>
      </span>
    </span>
  );
}

/** Def ids from a React useId value, cleaned of characters that would break `url(#...)`. */
const defId = (uid: string, name: string) => `franki-${name}-${uid.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/**
 * A studio microphone drawn in line: the capsule, its cradle, the stem and the foot. Muted, a slash crosses it,
 * cut out of the glyph by a mask so the strike reads on any background.
 */
function MicGlyph({ muted }: { muted: boolean }) {
  const mask = defId(useId(), "mic-strike");
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="h-5 w-5" data-mic={muted ? "struck" : "open"}>
      {muted ? (
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <rect width="20" height="20" fill="white" />
          <path d="M3.5 3.5 L16.5 16.5" stroke="black" strokeWidth="4.2" strokeLinecap="round" />
        </mask>
      ) : null}
      <g mask={muted ? `url(#${mask})` : undefined} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7.25" y="2.25" width="5.5" height="9.5" rx="2.75" />
        <path d="M7.25 6.5 H9 M7.25 8.75 H9" strokeWidth="1.1" />
        <path d="M4.5 9.25 A5.5 5.5 0 0 0 15.5 9.25" />
        <path d="M10 14.75 V17.5 M7 17.5 H13" />
      </g>
      {muted ? <path data-strike="" d="M3.5 3.5 L16.5 16.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : null}
    </svg>
  );
}

/*
 * The knurled bezel around the call button, in an 88 px box centred on the 64 px core. The core's brass ring
 * reaches 36 px from the centre; the bezel band runs from 37 to 44 px. The band is lit metal: a brass gradient
 * lit from the top left, a dark seat on the outside, a dark groove against the ring and a bright lip on its
 * upper inner edge. The knurl is a ring of fine dark ticks, 72 round and 80 square, drawn as a dashed stroke so
 * every tick is the same width. Only the round knurl turns (screen.css); the light on the band stays put.
 */
const BEZEL_BOX = 88;
const BAND = { center: 40.5, width: 7, tick: 1.1 } as const;
const ROUND_TICKS = 72;
const SQUARE_TICKS = 80;
/** The squared bezel: a rounded square whose band follows the hang-up core's 16 px outer corner. */
const SQUARE = { inset: BEZEL_BOX / 2 - BAND.center, size: BAND.center * 2, rx: 20.5 } as const;

const roundPerimeter = 2 * Math.PI * BAND.center;
const squarePerimeter = 4 * (SQUARE.size - 2 * SQUARE.rx) + 2 * Math.PI * SQUARE.rx;
const dashes = (perimeter: number, ticks: number) => `${BAND.tick} ${(perimeter / ticks - BAND.tick).toFixed(4)}`;

interface BandPaint {
  stroke: string;
  strokeWidth: number;
  strokeOpacity?: string;
  strokeDasharray?: string;
}

function BandShape({ round, ...paint }: { round: boolean } & BandPaint) {
  return round ? (
    <circle cx={BEZEL_BOX / 2} cy={BEZEL_BOX / 2} r={BAND.center} fill="none" {...paint} />
  ) : (
    <rect x={SQUARE.inset} y={SQUARE.inset} width={SQUARE.size} height={SQUARE.size} rx={SQUARE.rx} fill="none" {...paint} />
  );
}

function Bezel({ round }: { round: boolean }) {
  const uid = useId();
  const metal = defId(uid, "bezel-metal");
  const sheen = defId(uid, "bezel-sheen");
  const c = BEZEL_BOX / 2;
  const outer = BAND.center + BAND.width / 2;
  const inner = BAND.center - BAND.width / 2;
  // The bright lip sits just inside the band, past the groove, on the arc that faces the light.
  const lip = inner + 0.9;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-bezel-ring=""
      viewBox={`0 0 ${BEZEL_BOX} ${BEZEL_BOX}`}
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    >
      <defs>
        <linearGradient id={metal} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="var(--color-brass-hi)" />
          <stop offset="0.45" stopColor="var(--color-brass)" />
          <stop offset="1" stopColor="color-mix(in srgb, var(--color-brass) 55%, var(--color-night-0))" />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-spark)" stopOpacity="0.7" />
          <stop offset="0.32" stopColor="var(--color-spark)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* The seat: a soft dark edge the bezel sits in. */}
      {round ? (
        <circle cx={c} cy={c} r={outer + 0.5} fill="none" stroke="var(--color-night-0)" strokeOpacity="0.7" strokeWidth="1.5" />
      ) : (
        <rect x={SQUARE.inset - BAND.width / 2 - 0.5} y={SQUARE.inset - BAND.width / 2 - 0.5} width={SQUARE.size + BAND.width + 1} height={SQUARE.size + BAND.width + 1} rx={SQUARE.rx + BAND.width / 2 + 0.5} fill="none" stroke="var(--color-night-0)" strokeOpacity="0.7" strokeWidth="1.5" />
      )}
      <BandShape round={round} stroke={`url(#${metal})`} strokeWidth={BAND.width} />
      <g data-bezel-knurl="" className={round ? "franki-anim" : undefined}>
        <BandShape round={round} stroke="var(--color-night-0)" strokeOpacity="0.42" strokeWidth={BAND.width - 1.5} strokeDasharray={round ? dashes(roundPerimeter, ROUND_TICKS) : dashes(squarePerimeter, SQUARE_TICKS)} />
      </g>
      {/* Light that stays where it is while the knurl turns under it. */}
      <BandShape round={round} stroke={`url(#${sheen})`} strokeWidth={BAND.width} />
      {round ? (
        <>
          <circle cx={c} cy={c} r={inner} fill="none" stroke="var(--color-night-0)" strokeOpacity="0.8" strokeWidth="1" />
          <path d={`M ${(c - lip * 0.94).toFixed(2)} ${(c - lip * 0.34).toFixed(2)} A ${lip} ${lip} 0 0 1 ${(c + lip * 0.34).toFixed(2)} ${(c - lip * 0.94).toFixed(2)}`} fill="none" stroke="var(--color-spark)" strokeOpacity="0.55" strokeWidth="0.8" strokeLinecap="round" />
        </>
      ) : (
        <rect x={SQUARE.inset + BAND.width / 2} y={SQUARE.inset + BAND.width / 2} width={SQUARE.size - BAND.width} height={SQUARE.size - BAND.width} rx={SQUARE.rx - BAND.width / 2} fill="none" stroke="var(--color-night-0)" strokeOpacity="0.8" strokeWidth="1" />
      )}
    </svg>
  );
}

/** The focus ring sits just outside the bezel, so the metal never hides it (88 px box, 64 px core). */
const CALL_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-[14px] focus-visible:outline-brass-hi";

/**
 * A transparent pseudo-element 12 px past the 64 px core on every side, so hover and press cover the whole 88 px
 * bezel. Round for the start form; for hang-up, the squared bezel's outer corner (24 px).
 */
const BEZEL_HIT = "before:absolute before:-inset-3 before:content-['']";
const BEZEL_HIT_ROUND = `${BEZEL_HIT} before:rounded-full`;
const BEZEL_HIT_SQUARE = `${BEZEL_HIT} before:rounded-[24px]`;

/** A press sends the ring spark only on the start form, and only while the button can be pressed. */
export const pressSparks = (start: boolean, disabled: boolean) => start && !disabled;

/** The brass toggle beside the call button. Muted, it is pressed in: filled brass with the struck glyph. */
const MUTE_BUTTON = `${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-full transition-[color,background-color,border-color] duration-(--dur-quick)`;

/*
 * The cores' glass, from the colour tokens. The lit core is a bulb lit from inside: white-hot at the centre,
 * deeper green at the rim, a dark lower edge for depth and a soft green spill into the well around it. The dark
 * core is the same glass unlit. Over both sit a highlight up and to the left and a faint reflection along the
 * bottom.
 */
const CORE_LIT = {
  background:
    "radial-gradient(circle at 50% 44%, color-mix(in srgb, var(--color-spark) 70%, var(--color-ecto)) 0%, var(--color-ecto) 42%, color-mix(in srgb, var(--color-ecto) 62%, var(--color-night-0)) 100%)",
  boxShadow:
    "inset 0 -4px 7px color-mix(in srgb, var(--color-night-0) 38%, transparent), inset 0 1px 2px color-mix(in srgb, var(--color-spark) 55%, transparent), 0 0 10px color-mix(in srgb, var(--color-ecto) 45%, transparent), 0 0 28px color-mix(in srgb, var(--color-ecto) 22%, transparent)",
} as const;
const CORE_DARK = {
  background: "radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--color-ink) 7%, var(--color-night-2)) 0%, var(--color-night-1) 70%, var(--color-night-0) 100%)",
  boxShadow: "inset 0 -3px 6px color-mix(in srgb, var(--color-night-0) 60%, transparent)",
} as const;
const CORE_SHEEN = {
  background:
    "radial-gradient(ellipse 46% 34% at 36% 26%, color-mix(in srgb, var(--color-spark) 75%, transparent) 0%, transparent 100%), radial-gradient(ellipse 50% 22% at 50% 96%, color-mix(in srgb, var(--color-spark) 30%, transparent) 0%, transparent 100%)",
} as const;
const CORE_SHEEN_DARK = { background: "radial-gradient(ellipse 46% 34% at 36% 26%, color-mix(in srgb, var(--color-ink) 12%, transparent) 0%, transparent 100%)" } as const;
/** The recessed well between the core and the brass ring: shadowed at the top, lit green from the core below. */
const WELL_LIT = { boxShadow: "inset 0 3px 6px color-mix(in srgb, var(--color-night-0) 85%, transparent), inset 0 0 14px color-mix(in srgb, var(--color-ecto) 18%, transparent)" } as const;
const WELL_DARK = { boxShadow: "inset 0 3px 6px color-mix(in srgb, var(--color-night-0) 85%, transparent)" } as const;
/**
 * Plasma turning slowly inside the glass: a white-hot arm and a deep green one opposite, blurred soft, so the
 * light inside the bulb visibly moves even though the core is already bright.
 */
const PLASMA = {
  background:
    "conic-gradient(from 20deg, transparent 0turn, color-mix(in srgb, var(--color-spark) 80%, transparent) 0.09turn, transparent 0.22turn, transparent 0.42turn, color-mix(in srgb, var(--color-ecto) 45%, var(--color-night-0)) 0.56turn, transparent 0.72turn)",
  filter: "blur(6px)",
} as const;
/** The brushed brass of the ring around the core, as a conic sweep cut to the ring's 4 px band. */
const RING_METAL = {
  background:
    "conic-gradient(from 200deg, var(--color-brass-hi), var(--color-brass) 0.12turn, color-mix(in srgb, var(--color-brass) 55%, var(--color-night-0)) 0.3turn, var(--color-brass) 0.45turn, var(--color-brass-hi) 0.56turn, var(--color-brass) 0.7turn, color-mix(in srgb, var(--color-brass) 65%, var(--color-night-0)) 0.86turn, var(--color-brass-hi))",
  WebkitMask: "radial-gradient(circle closest-side, transparent 31.4px, black 32px)",
  mask: "radial-gradient(circle closest-side, transparent 31.4px, black 32px)",
} as const;
/** The glyph's etch: a thin lit edge under the dark strokes. */
const GLYPH_ETCH = { filter: "drop-shadow(0 0.75px 0 color-mix(in srgb, var(--color-spark) 70%, transparent))" } as const;
/** The aura behind the button: ecto while it can start a call, ember while a call is live. */
const AURA_ECTO = { background: "radial-gradient(closest-side, color-mix(in srgb, var(--color-ecto) 30%, transparent) 0%, color-mix(in srgb, var(--color-ecto) 10%, transparent) 55%, transparent 100%)" } as const;
const AURA_EMBER = { background: "radial-gradient(closest-side, color-mix(in srgb, var(--color-ember) 26%, transparent) 0%, color-mix(in srgb, var(--color-ember) 8%, transparent) 55%, transparent 100%)" } as const;
/** The press: a brass comet's tail behind the ring spark, a flash in the core and a shockwave off the ring. */
const COMET_TAIL = {
  background: "conic-gradient(transparent 0turn 0.68turn, color-mix(in srgb, var(--color-brass-hi) 55%, transparent) 0.9turn, var(--color-spark) 1turn)",
  WebkitMask: "radial-gradient(circle closest-side, transparent 30.5px, black 31.5px, black 35px, transparent 36px)",
  mask: "radial-gradient(circle closest-side, transparent 30.5px, black 31.5px, black 35px, transparent 36px)",
} as const;
const CORE_FLASH = { background: "radial-gradient(circle closest-side, var(--color-spark) 0%, color-mix(in srgb, var(--color-ecto) 70%, transparent) 55%, transparent 100%)" } as const;
/** The ember's glass: lit from above, darker at the foot, with a lit lip along the top edge. */
const EMBER_GLASS = {
  background: "linear-gradient(170deg, color-mix(in srgb, var(--color-spark) 34%, transparent) 0%, transparent 42%, color-mix(in srgb, var(--color-night-0) 30%, transparent) 100%)",
  boxShadow: "inset 0 1px 1px color-mix(in srgb, var(--color-spark) 55%, transparent), inset 0 -4px 8px color-mix(in srgb, var(--color-night-0) 30%, transparent)",
} as const;
const STOP_ETCH = { boxShadow: "0 1px 0 color-mix(in srgb, var(--color-spark) 45%, transparent), inset 0 1px 2px color-mix(in srgb, var(--color-ink) 12%, transparent)" } as const;

/** The status lines under the call button: mono 12. */
const STATUS = "max-w-[343px] text-center font-mono text-xs";

/**
 * The ring spark's shell: runs ringSparkStep and its grant commands against the budget, and tells React.
 * DOM-free, with the budget injected, so it is exported for its node tests.
 */
export class RingSparkShell {
  private state: RingSpark = RING_SPARK_IDLE;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly budget: ElectricityBudget) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.state;

  readonly dispatch = (event: RingSparkEvent) => {
    const before = this.state;
    this.run(event);
    if (this.state !== before) for (const l of this.listeners) l();
  };

  private run(event: RingSparkEvent): void {
    const r = ringSparkStep(this.state, event);
    this.state = r.state;
    for (const c of r.commands) {
      if (c.kind === "request") this.run({ type: "granted", token: this.budget.request() });
      else this.budget.release(c.token);
    }
  }
}

/** A spark that runs once around the call button's ring; only with Reduced_Motion off and a grant. */
function useRingSpark(reduced: boolean, start: boolean) {
  const [shell] = useState(() => new RingSparkShell(electricityBudget));
  const spark = useSyncExternalStore(shell.subscribe, shell.getSnapshot, shell.getSnapshot);
  useEffect(() => {
    for (const event of ringSparkPropEvents(start, reduced)) shell.dispatch(event);
  }, [shell, start, reduced]);
  useEffect(() => () => shell.dispatch({ type: "unmount" }), [shell]);
  const fire = () => shell.dispatch({ type: "pressed", start, reduced });
  // The spark's own turn ends it. The flash and shockwave inside it end sooner, and their events bubble up.
  const ended = (token: number) => (e: { target: EventTarget; currentTarget: EventTarget }) => {
    if (e.target === e.currentTarget) shell.dispatch({ type: "animationEnd", token });
  };
  // React has no onAnimationCancel prop, so the span's ref listens for the DOM event itself.
  const listen = (token: number) => (el: HTMLSpanElement | null) => {
    if (el === null) return;
    const cancelled = (e: Event) => {
      if (e.target === el) shell.dispatch({ type: "animationCancel", token });
    };
    el.addEventListener("animationcancel", cancelled);
    return () => el.removeEventListener("animationcancel", cancelled);
  };
  return { spark, fire, ended, listen };
}

export function CallScreen({ voice, enabled, configMissing = null, onCall, onHangUp, onToggleMute, onRetry }: CallScreenProps) {
  const reduced = useReducedMotion();
  const button = callButton(voice);
  const start = button.form === "start";
  const ring = useRingSpark(reduced, start);
  const disabled = !enabled || (start && configMissing !== null) || button.disabled;
  const showRetry = (voice.phase === "RECOVERY" && voice.retryVisible) || voice.stateRetryVisible;
  const showMute = muteVisible(voice);
  // Lit only when it can be pressed: disabled, the bezel dims and the start core goes dark (no presence glow).
  const lit = !disabled;
  // The aura breathes behind a button that can start a call, and glows ember behind a live one.
  const aura = start ? (lit ? "ecto" : null) : voice.hangingUp ? null : "ember";
  return (
    <section aria-label="Call" className="flex flex-col items-center gap-3">
      {/* Three columns, so the call button stays on Franki's axis when the mute toggle appears beside it. */}
      <div className="grid grid-cols-[2.75rem_auto_2.75rem] items-center gap-4">
        <span
          data-call-bezel={start ? "round" : "square"}
          data-bezel-state={lit ? "lit" : "dim"}
          className="relative col-start-2 inline-grid size-22 place-items-center"
        >
          {/* Before the button in the DOM, so the button and its focus ring paint over the metal. */}
          {aura === null ? null : (
            <span aria-hidden="true" data-power-aura={start ? "ecto" : "ember"} className="pointer-events-none absolute -inset-9">
              <span className="franki-anim absolute inset-0 rounded-full" style={aura === "ecto" ? AURA_ECTO : AURA_EMBER} />
            </span>
          )}
          {/* The dial plate shows around the round bezel only; the squared bezel's corners would cross its rivets. */}
          <span aria-hidden="true" data-power-dial={start ? "on" : "off"} className={`pointer-events-none absolute -inset-4 ${lit ? "" : "opacity-45"}`}>
            <Dial lit={start && lit} />
          </span>
          <span aria-hidden="true" className={`pointer-events-none absolute inset-0 transition-opacity duration-(--dur-base) ${lit ? "opacity-100" : "opacity-45"}`}>
            <Bezel round={start} />
          </span>
          {start && lit ? <DialCharge /> : null}
          <motion.button
            type="button"
            data-form={button.form}
            data-shape={start ? "round" : "square"}
            className={
              start
                ? `${CALL_FOCUS} ${BEZEL_HIT_ROUND} relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-night-1 ring-4 ${lit ? "text-night-0 shadow-brass-glow ring-brass" : "text-ink-dim ring-brass/55"}`
                : `${CALL_FOCUS} ${BEZEL_HIT_SQUARE} relative inline-flex h-16 w-16 items-center justify-center rounded-control bg-ember text-night-0 ring-4 ring-brass disabled:opacity-40`
            }
            aria-label={start ? COPY.call.start : COPY.call.hangUp}
            disabled={disabled}
            onClick={start ? onCall : onHangUp}
            onPointerDown={pressSparks(start, disabled) ? ring.fire : undefined}
            whileTap={disabled ? undefined : { y: 2 }}
            transition={{ type: "spring", ...SPRING.press }}
          >
            {start ? (
              <span key="start" aria-hidden="true" data-power-face="start" className="franki-anim pointer-events-none absolute inset-0 grid place-items-center rounded-full">
                {/* The brushed brass ring and the recessed well it holds. */}
                <span className={`absolute -inset-1 rounded-full ${lit ? "" : "opacity-40"}`} style={RING_METAL} />
                <span className="absolute inset-0 rounded-full" style={lit ? WELL_LIT : WELL_DARK} />
                {lit ? (
                  <span data-core="lit" className="absolute inset-2 rounded-full bg-ecto" style={CORE_LIT} />
                ) : (
                  <span data-core="dark" className="absolute inset-2 rounded-full border border-stitch bg-night-2" style={CORE_DARK} />
                )}
                {lit ? (
                  <span data-power-plasma="" className="absolute inset-2 overflow-hidden rounded-full">
                    <span className="franki-anim absolute -inset-1.5 rounded-full" style={PLASMA} />
                  </span>
                ) : null}
                {lit ? <span data-power-glow="" className="absolute inset-2 rounded-full" style={CORE_FLASH} /> : null}
                {/* The core is glass: a highlight up and to the left, and a faint reflection along the bottom. */}
                <span className="absolute inset-2 rounded-full" style={lit ? CORE_SHEEN : CORE_SHEEN_DARK} />
                <PowerGlyph lit={lit} />
              </span>
            ) : (
              <span key="hangup" aria-hidden="true" data-power-face="hangup" className="franki-anim pointer-events-none absolute inset-0 grid place-items-center rounded-control">
                {/* The call catches: one ember ring off the squared form as it arrives. */}
                <span data-power-ignite="" className="franki-anim absolute -inset-1 rounded-[20px] border-2 border-ember" />
                <span className="absolute inset-0 rounded-control" style={EMBER_GLASS} />
                <span className="relative h-5 w-5 rounded-sm bg-night-0" style={STOP_ETCH} />
              </span>
            )}
            {start && ring.spark.mode === "sparking" ? (
              <span
                key={ring.spark.token}
                aria-hidden="true"
                data-ring-spark=""
                className="franki-ring-spark pointer-events-none absolute -inset-1"
                onAnimationEnd={ring.ended(ring.spark.token)}
                ref={ring.listen(ring.spark.token)}
              >
                <span data-power-shock="" className="absolute inset-0 rounded-full border-2 border-ecto" />
                <span data-power-flash="" className="absolute inset-3 rounded-full" style={CORE_FLASH} />
                <span className="absolute inset-0 rounded-full" style={COMET_TAIL} />
                <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-spark shadow-brass-glow" />
              </span>
            ) : null}
          </motion.button>
        </span>
        {showMute ? (
          <motion.button
            type="button"
            aria-pressed={voice.micMuted}
            aria-label={voice.micMuted ? COPY.call.unmute : COPY.call.mute}
            onClick={onToggleMute}
            whileTap={{ y: 2 }}
            transition={{ type: "spring", ...SPRING.press }}
            className={`${MUTE_BUTTON} col-start-3 justify-self-start ${voice.micMuted ? "mat-brass" : "border border-brass/70 text-brass hover:border-brass hover:bg-brass/10 hover:text-brass-hi"}`}
          >
            <MicGlyph muted={voice.micMuted} />
          </motion.button>
        ) : null}
      </div>
      {voice.micMuted && showMute ? (
        <p data-testid="muted-indicator" className={`${STATUS} text-brass`}>
          {COPY.call.muted}
        </p>
      ) : null}
      {showRetry ? (
        <button type="button" onClick={onRetry} className={RETRY_BUTTON}>
          {COPY.call.retry}
        </button>
      ) : null}
      {voice.error !== null ? (
        // An unconfirmed close is information, not a failure: the call already ended for the user.
        <p role={voice.error === "close" ? "status" : "alert"} data-step={voice.error} className={`${STATUS} ${voice.error === "close" ? "text-ink-dim" : "text-ember"}`}>
          {CALL_ERRORS[voice.error]}
        </p>
      ) : null}
      {configMissing !== null ? (
        <p data-config-missing={configMissing} className={`${STATUS} text-ink-dim`}>
          {COPY.call.notSetUp}
        </p>
      ) : null}
    </section>
  );
}
