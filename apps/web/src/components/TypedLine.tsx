"use client";
// The Typed_Line (lab-ui-foundation R14.7, R14.8, R18.1 to R18.3). Collapsed, a keyboard-glyph button
// "Type to Franki". Open, a one-row textarea styled as a single line: Enter sends, Shift+Enter and
// pasted text keep line feeds (so the server's pasted classification is unchanged), IME composition is
// respected, and Escape collapses it when empty. Send rules are those of TypedTurns (FSC R18).
// Collapsed, the glyph is quiet: no edge, ink-dim. Open, the line is one glass capsule with a stitched inner
// outline and a brass Send, and it materializes (screen.css). The capsule's ring shows keyboard focus.
import { type KeyboardEvent, useState } from "react";
import { COPY } from "../ui/copy";
import type { TypedInputProps } from "./TypedInput";
import { FOCUS, TARGET } from "./surfaces/classes";

export type TypedKey = { key: string; shiftKey: boolean; isComposing: boolean };

/** What one key press in the open line does. */
export function typedKeyAction(k: TypedKey, text: string, sendDisabled: boolean): "send" | "collapse" | "newline" | "none" {
  if (k.isComposing) return "none";
  if (k.key === "Enter") return k.shiftKey ? "newline" : sendDisabled ? "none" : "send";
  if (k.key === "Escape" && text === "") return "collapse";
  return "none";
}

/** A keyboard drawn in line: the case, three rows of keys and the space bar. */
function KeyboardGlyph() {
  return (
    <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false" className="h-4 w-6">
      <rect x="0.9" y="0.9" width="22.2" height="14.2" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4.6 4.6h1.2M8.3 4.6h1.2M12 4.6h1.2M15.7 4.6h1.2M19.2 4.6h0.4M5.8 8h1.2M9.5 8h1.2M13.2 8h1.2M16.9 8h1.2M7.5 11.6h9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The open line: one glass capsule, the stitched outline inside its edge, and an ink-dim outline so the field reads as one. */
const CAPSULE =
  "mat-glass franki-materialize relative flex w-full items-center gap-1 rounded-chip p-1.5 outline outline-1 -outline-offset-1 outline-ink-dim/60 has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-brass-hi";

/** The brass Send inside the capsule. */
const SEND = `${TARGET} ${FOCUS} mat-brass inline-flex shrink-0 items-center justify-center rounded-chip px-4 text-sm font-medium transition-[transform,opacity] duration-(--dur-quick) active:translate-y-0.5 disabled:opacity-45`;

export interface TypedLineFieldProps extends TypedInputProps {
  onCollapse: () => void;
}

export function TypedLineField({ text, enabled, sending, canSend, error, onChange, onSubmit, onPaste, onCollapse }: TypedLineFieldProps) {
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
      <div data-typed-capsule="" className={CAPSULE}>
        <textarea
          aria-label={COPY.typed.label}
          value={text}
          rows={1}
          autoFocus
          disabled={!enabled}
          onChange={(e) => onChange(e.target.value)}
          onPaste={() => onPaste?.()}
          onKeyDown={onKeyDown}
          className="relative min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 pl-4 pr-2 text-left text-base text-ink focus-visible:outline-none disabled:opacity-50"
        />
        <span aria-hidden="true" data-stitch-outline="" className="pointer-events-none absolute inset-[3px] rounded-chip border border-dashed border-stitch" />
        <button type="submit" disabled={sendDisabled} className={`${SEND} relative`}>
          {sending ? "Sending…" : COPY.typed.send}
        </button>
      </div>
      {error !== null ? (
        <p role="alert" className="px-4 text-left text-sm text-ember">
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
      className={`${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-full text-ink-dim transition-colors duration-(--dur-quick) hover:bg-night-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-dim`}
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
