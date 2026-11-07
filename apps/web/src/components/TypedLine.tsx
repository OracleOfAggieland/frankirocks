"use client";
// The Typed_Line (lab-ui-foundation R14.7, R14.8, R18.1 to R18.3). Collapsed, a keyboard-glyph button
// "Type to Franki". Open, a one-row textarea styled as a single line: Enter sends, Shift+Enter and
// pasted text keep line feeds (so the server's pasted classification is unchanged), IME composition is
// respected, and Escape collapses it when empty. Send rules are those of TypedTurns (FSC R18).
import { type KeyboardEvent, useState } from "react";
import { COPY } from "../ui/copy";
import type { TypedInputProps } from "./TypedInput";
import { BRASS_BUTTON, FOCUS, TARGET } from "./surfaces/classes";

export type TypedKey = { key: string; shiftKey: boolean; isComposing: boolean };

/** What one key press in the open line does. */
export function typedKeyAction(k: TypedKey, text: string, sendDisabled: boolean): "send" | "collapse" | "newline" | "none" {
  if (k.isComposing) return "none";
  if (k.key === "Enter") return k.shiftKey ? "newline" : sendDisabled ? "none" : "send";
  if (k.key === "Escape" && text === "") return "collapse";
  return "none";
}

function KeyboardGlyph() {
  return (
    <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false" className="h-4 w-6">
      <rect x="1" y="1" width="22" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 5h2M9 5h2M13 5h2M17 5h2M5 8.5h2M9 8.5h2M13 8.5h2M17 8.5h2M7 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export interface TypedLineFieldProps extends TypedInputProps {
  onCollapse: () => void;
}

export function TypedLineField({ text, enabled, sending, canSend, error, onChange, onSubmit, onCollapse }: TypedLineFieldProps) {
  const sendDisabled = !enabled || !canSend;
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = typedKeyAction({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing }, text, sendDisabled);
    if (action === "send" || (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing)) e.preventDefault();
    if (action === "send") onSubmit();
    if (action === "collapse") {
      e.preventDefault();
      onCollapse();
    }
  };
  return (
    <form
      aria-label={COPY.typed.label}
      data-typed-line="open"
      className="flex w-full max-w-[343px] flex-col gap-2 sm:max-w-xl"
      onSubmit={(e) => {
        e.preventDefault();
        if (!sendDisabled) onSubmit();
      }}
    >
      <div className="flex gap-2">
        <textarea
          aria-label={COPY.typed.label}
          value={text}
          rows={1}
          autoFocus
          disabled={!enabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className={`${FOCUS} min-h-11 flex-1 resize-none rounded-control border border-ink-dim bg-night-1 px-3 py-2.5 text-left text-base text-ink disabled:opacity-50`}
        />
        <button type="submit" disabled={sendDisabled} className={BRASS_BUTTON}>
          {sending ? "Sending…" : COPY.typed.send}
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

export function TypedLineCollapsed({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={COPY.typed.open}
      data-typed-line="collapsed"
      disabled={!enabled}
      onClick={onOpen}
      className={`${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control border border-ink-dim text-ink-dim hover:text-ink disabled:opacity-40`}
    >
      <KeyboardGlyph />
    </button>
  );
}

export function TypedLine(props: TypedInputProps & { defaultOpen?: boolean }) {
  const { defaultOpen = false, ...field } = props;
  const [open, setOpen] = useState(defaultOpen);
  if (!open || !field.enabled) return <TypedLineCollapsed enabled={field.enabled} onOpen={() => setOpen(true)} />;
  return <TypedLineField {...field} onCollapse={() => setOpen(false)} />;
}
