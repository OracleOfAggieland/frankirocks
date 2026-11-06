import { type VoiceState, avatarState, callButton, muteVisible } from "@franki/core";
import { StandInAvatar } from "./StandInAvatar";

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

/**
 * The call screen (R16.1–R16.6, R15.6, R15.9, R13.8, R15.8): the Stand_In_Avatar, exactly one call button whose
 * start and hang-up forms differ in colour and shape, the mute toggle only while listening, thinking or speaking,
 * an error naming the failed step, and the explicit retry control. Presentational only.
 */
export function CallScreen({ voice, enabled, configMissing = null, onCall, onHangUp, onToggleMute, onRetry }: CallScreenProps) {
  const avatar = avatarState(voice);
  const button = callButton(voice);
  const start = button.form === "start";
  const disabled = !enabled || (start && configMissing !== null) || button.disabled;
  const showRetry = (voice.phase === "RECOVERY" && voice.retryVisible) || voice.stateRetryVisible;
  return (
    <section aria-label="Call" className="flex flex-col items-center gap-4">
      <StandInAvatar state={avatar} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-form={button.form}
          aria-label={start ? "Call Franki" : "Hang up"}
          disabled={disabled}
          onClick={start ? onCall : onHangUp}
          className={
            start
              ? "rounded-full bg-ecto px-6 py-3 font-medium text-night-0 disabled:opacity-40"
              : "rounded-md bg-ember px-6 py-3 font-medium text-night-0 disabled:opacity-40"
          }
        >
          {start ? "Call" : "Hang up"}
        </button>
        {muteVisible(voice) ? (
          <button
            type="button"
            aria-pressed={voice.micMuted}
            aria-label={voice.micMuted ? "Unmute microphone" : "Mute microphone"}
            onClick={onToggleMute}
            className={voice.micMuted ? "rounded border border-ember px-3 py-2 text-sm text-ember" : "rounded border border-ink-dim px-3 py-2 text-sm"}
          >
            {voice.micMuted ? "Muted" : "Mute"}
          </button>
        ) : null}
      </div>
      {voice.micMuted && muteVisible(voice) ? (
        <p data-testid="muted-indicator" className="text-xs text-ember">
          Your microphone is muted.
        </p>
      ) : null}
      {showRetry ? (
        <button type="button" onClick={onRetry} className="rounded border border-brass px-3 py-1 text-sm text-brass">
          Retry
        </button>
      ) : null}
      {voice.error !== null ? (
        <p role="alert" data-step={voice.error} className="max-w-sm text-sm text-ember">
          {CALL_ERRORS[voice.error]}
        </p>
      ) : null}
      {configMissing !== null ? <p className="text-xs text-ink-dim">Calls are not configured. Missing: {configMissing}.</p> : null}
    </section>
  );
}
