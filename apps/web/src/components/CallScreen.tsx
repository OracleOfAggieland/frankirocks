"use client";
// The call controls (lab-ui-foundation R10.4, R14.4 to R14.6, R18.1 to R18.3; keeps FSC R16.4 to R16.6,
// R13.8, R15.8). Exactly one call button whose start and hang-up forms differ in shape and colour:
// start is a round brass ring around a power glyph with an ecto core; hang-up is a squared ember form.
// The mute toggle shows only while listening, thinking or speaking. Errors and Retry stay inline.
import { type VoiceState, callButton, muteVisible } from "@franki/core";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { COPY } from "../ui/copy";
import { electricityBudget } from "../ui/electricity-budget";
import { useReducedMotion } from "../ui/hooks/reduced-motion";
import { SPRING } from "../ui/motion";
import { FOCUS, QUIET_BUTTON, TARGET } from "./surfaces/classes";

export const CALL_ERRORS: Record<NonNullable<VoiceState["error"]>, string> = {
  open: "The call did not start: session open failed or did not answer within 5 seconds. Press call to try again.",
  close: "Hung up here, but the server did not confirm closing the session. It closes on its own when it expires.",
};

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

function MicGlyph({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="h-5 w-5">
      <rect x="7" y="2" width="6" height="10" rx="3" fill="currentColor" />
      <path d="M4.5 9.5 A5.5 5.5 0 0 0 15.5 9.5 M10 15 V18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {muted ? <path d="M3 3 L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : null}
    </svg>
  );
}

/** A spark that runs once around the call button's ring; only with Reduced_Motion off and a grant. */
function useRingSpark(reduced: boolean) {
  const [spark, setSpark] = useState(0);
  const token = useRef<number | null>(null);
  const fire = () => {
    if (reduced || token.current !== null) return;
    const t = electricityBudget.request();
    if (t === null) return;
    token.current = t;
    setSpark((n) => n + 1);
  };
  const done = () => {
    if (token.current !== null) electricityBudget.release(token.current);
    token.current = null;
    setSpark(0);
  };
  return { spark, fire, done };
}

export function CallScreen({ voice, enabled, configMissing = null, onCall, onHangUp, onToggleMute, onRetry }: CallScreenProps) {
  const reduced = useReducedMotion();
  const ring = useRingSpark(reduced);
  const button = callButton(voice);
  const start = button.form === "start";
  const disabled = !enabled || (start && configMissing !== null) || button.disabled;
  const showRetry = (voice.phase === "RECOVERY" && voice.retryVisible) || voice.stateRetryVisible;
  const showMute = muteVisible(voice);
  return (
    <section aria-label="Call" className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-4">
        <motion.button
          type="button"
          data-form={button.form}
          data-shape={start ? "round" : "square"}
          className={
            start
              ? `${FOCUS} relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-night-1 text-night-0 shadow-brass-glow ring-4 ring-brass disabled:opacity-40`
              : `${FOCUS} relative inline-flex h-16 w-16 items-center justify-center rounded-control bg-ember text-night-0 disabled:opacity-40`
          }
          aria-label={start ? COPY.call.start : COPY.call.hangUp}
          disabled={disabled}
          onClick={start ? onCall : onHangUp}
          onPointerDown={start ? ring.fire : undefined}
          whileTap={disabled ? undefined : { y: 2 }}
          transition={{ type: "spring", ...SPRING.press }}
        >
          {start ? (
            <>
              <span aria-hidden="true" className="absolute inset-2 rounded-full bg-ecto shadow-ecto-glow" />
              <PowerGlyph />
              {ring.spark > 0 ? (
                <span key={ring.spark} aria-hidden="true" data-ring-spark="" className="franki-ring-spark pointer-events-none absolute -inset-1" onAnimationEnd={ring.done}>
                  <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-spark shadow-brass-glow" />
                </span>
              ) : null}
            </>
          ) : (
            <span aria-hidden="true" className="h-5 w-5 rounded-sm bg-night-0" />
          )}
        </motion.button>
        {showMute ? (
          <motion.button
            type="button"
            aria-pressed={voice.micMuted}
            aria-label={voice.micMuted ? COPY.call.unmute : COPY.call.mute}
            onClick={onToggleMute}
            whileTap={{ y: 2 }}
            transition={{ type: "spring", ...SPRING.press }}
            className={`${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control border border-brass ${voice.micMuted ? "bg-brass text-night-0" : "text-brass hover:bg-night-1"}`}
          >
            <MicGlyph muted={voice.micMuted} />
          </motion.button>
        ) : null}
      </div>
      {voice.micMuted && showMute ? (
        <p data-testid="muted-indicator" className="text-sm text-brass">
          {COPY.call.muted}
        </p>
      ) : null}
      {showRetry ? (
        <button type="button" onClick={onRetry} className={`${QUIET_BUTTON} border-brass text-brass`}>
          {COPY.call.retry}
        </button>
      ) : null}
      {voice.error !== null ? (
        <p role="alert" data-step={voice.error} className="max-w-[343px] text-sm text-ember">
          {CALL_ERRORS[voice.error]}
        </p>
      ) : null}
      {configMissing !== null ? <p className="text-xs text-ink-dim">Calls are not configured. Missing: {configMissing}.</p> : null}
    </section>
  );
}
