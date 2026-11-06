import type { KeyboardEvent } from "react";
import type { ConversationEntry } from "../client/typed-turns";

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

/** The conversation view: typed lines and Franki's text replies, as plain text (R18.6). */
export function ConversationView({ entries }: { entries: ConversationEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ol aria-label="Conversation" className="flex w-full max-w-xl flex-col gap-2 text-left text-sm">
      {entries.map((e) => (
        <li key={e.key} data-role={e.role} className={e.role === "user" ? "self-end rounded bg-night-2 px-3 py-2" : "self-start rounded bg-night-1 px-3 py-2 text-ink"}>
          <span className="sr-only">{e.role === "user" ? "You: " : "Franki: "}</span>
          {e.text}
        </li>
      ))}
    </ol>
  );
}
