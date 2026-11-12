"use client";
// The call controls (lab-ui-foundation R10.4, R14.4 to R14.6, R18.1 to R18.3; keeps FSC R16.4 to R16.6,
// R13.8, R15.8). Exactly one call button whose start and hang-up forms differ in shape and colour:
// start is a round brass ring around a power glyph with an ecto core; hang-up is a squared ember form.
// Each sits in a knurled brass bezel (round or squared) that turns slowly on hover and focus; disabled, the
// bezel dims and the start core goes dark. The mute toggle shows only while listening, thinking or speaking,
// in its own column so the call button never moves off Franki's axis. Errors and Retry stay inline, in mono 12.
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

function PowerGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="relative h-6 w-6">
      <path d="M12 3 V11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M7.5 6.5 A7 7 0 1 0 16.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
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

/** Glass highlights on the cores, from the colour tokens. */
const CORE_SHEEN = { background: "radial-gradient(circle at 34% 28%, color-mix(in srgb, var(--color-spark) 60%, transparent) 0%, transparent 46%)" } as const;
const CORE_SHEEN_DARK = { background: "radial-gradient(circle at 34% 28%, color-mix(in srgb, var(--color-ink) 9%, transparent) 0%, transparent 52%)" } as const;
const EMBER_SHEEN = { background: "linear-gradient(160deg, color-mix(in srgb, var(--color-spark) 30%, transparent) 0%, transparent 45%)" } as const;

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
  const ended = (token: number) => () => shell.dispatch({ type: "animationEnd", token });
  // React has no onAnimationCancel prop, so the span's ref listens for the DOM event itself.
  const listen = (token: number) => (el: HTMLSpanElement | null) => {
    if (el === null) return;
    const cancelled = () => shell.dispatch({ type: "animationCancel", token });
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
          <span aria-hidden="true" className={`pointer-events-none absolute inset-0 transition-opacity duration-(--dur-base) ${lit ? "opacity-100" : "opacity-45"}`}>
            <Bezel round={start} />
          </span>
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
              <>
                {lit ? (
                  <span aria-hidden="true" data-core="lit" className="absolute inset-2 rounded-full bg-ecto shadow-ecto-glow" />
                ) : (
                  <span aria-hidden="true" data-core="dark" className="absolute inset-2 rounded-full border border-stitch bg-night-2" />
                )}
                {/* The core is glass lit from inside: a soft highlight up and to the left. */}
                <span aria-hidden="true" className="pointer-events-none absolute inset-2 rounded-full" style={lit ? CORE_SHEEN : CORE_SHEEN_DARK} />
                <PowerGlyph />
                {ring.spark.mode === "sparking" ? (
                  <span
                    key={ring.spark.token}
                    aria-hidden="true"
                    data-ring-spark=""
                    className="franki-ring-spark pointer-events-none absolute -inset-1"
                    onAnimationEnd={ring.ended(ring.spark.token)}
                    ref={ring.listen(ring.spark.token)}
                  >
                    <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-spark shadow-brass-glow" />
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-control" style={EMBER_SHEEN} />
                <span aria-hidden="true" className="relative h-5 w-5 rounded-sm bg-night-0" />
              </>
            )}
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
