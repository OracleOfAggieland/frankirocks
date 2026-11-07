import type { KeyboardEvent } from "react";

export interface TypedInputProps {
  text: string;
  /** False while signed out (R9.4). */
  enabled: boolean;
  sending: boolean;
  canSend: boolean;
  error: string | null;
  onChange: (text: string) => void;
  onSubmit: () => void;
}

/**
 * The typed-line box (R18.1, R18.8–R18.10). Enter sends; Shift+Enter adds a line break, so pasted multi-line text
 * can be sent and is classified as pasted by the server. Presentational only; state lives in `TypedTurns`.
 */
export function TypedInput({ text, enabled, sending, canSend, error, onChange, onSubmit }: TypedInputProps) {
  const sendDisabled = !enabled || !canSend;
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!sendDisabled) onSubmit();
    }
  };
  return (
    <form
      aria-label="Typed input"
      className="flex w-full max-w-xl flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!sendDisabled) onSubmit();
      }}
    >
      <div className="flex gap-2">
        <textarea
          aria-label="Type to Franki"
          value={text}
          rows={2}
          disabled={!enabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="flex-1 resize-y rounded border border-ink-dim bg-night-1 p-2 text-left text-sm text-ink disabled:opacity-50"
        />
        <button type="submit" disabled={sendDisabled} className="rounded bg-brass px-4 text-sm font-medium text-night-0 disabled:opacity-40">
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      {error !== null ? (
        <p role="alert" className="text-left text-sm text-ember">
          {error}
        </p>
      ) : null}
    </form>
  );
}
