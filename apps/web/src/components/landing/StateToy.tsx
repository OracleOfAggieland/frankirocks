"use client";
// The state toy on the front door's stage (brief 015, package H2): four chips that put Franki in a state, as a
// radio group. One chip is in the tab order, the one picked; the arrow keys, Home and End move the pick and the
// focus together. Each chip is something you can touch: a glass capsule with a brass edge, and brass when
// picked. Each carries a line glyph of its state: an ear, a bolt, a struck-through microphone, a burst.
// The chips rise into place on STAGGER and press 2 px; both stop under reduced motion (stage.css).
import { type CSSProperties, type KeyboardEvent, type ReactNode, useLayoutEffect, useRef } from "react";
import { LANDING } from "../../ui/copy-landing";
import { TOY_STATES, type ToyState } from "../../ui/landing/steps";
import { FOCUS, TARGET } from "../surfaces/classes";

const GLYPH: Record<ToyState, ReactNode> = {
  // An ear: the outer rim curling into the lobe, and the inner fold.
  listening: (
    <>
      <path d="M4.6 6.4a3.6 3.6 0 1 1 7.2 0c0 1.5-.8 2.3-1.6 3-.8.7-1.2 1.3-1.2 2.3a1.8 1.8 0 0 1-3.4.8" />
      <path d="M6.7 6.6a1.5 1.5 0 0 1 3 0c0 .8-.5 1.2-1 1.6" />
    </>
  ),
  // A bolt.
  thinking: <path d="M9.2 1.8 4.2 9h3.5l-.9 5.2L11.8 7H8.3z" />,
  // A microphone, struck through.
  muted: (
    <>
      <rect x="6" y="2" width="4" height="7.4" rx="2" />
      <path d="M3.9 7.6a4.1 4.1 0 0 0 8.2 0M8 11.7v2.3M5.9 14h4.2" />
      <path d="M2.6 2.6l10.8 10.8" />
    </>
  ),
  // A four-point burst with two small sparks.
  celebrate: (
    <>
      <path d="M7 3.2 8.2 6.8 11.8 8 8.2 9.2 7 12.8 5.8 9.2 2.2 8 5.8 6.8z" />
      <path d="M12.4 2.6v2.2M11.3 3.7h2.2M12.6 11.4v1.6M11.8 12.2h1.6" />
    </>
  ),
};

/** Which modifier keys are held. */
export interface KeyMods {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/**
 * Pure. The pick after a key press in the group, or null for a key the group does not use. A key pressed with
 * Alt, Ctrl or Meta belongs to the browser (Alt+Left goes back), so the group leaves it alone.
 */
export function toyKeyStep(current: ToyState, key: string, mods: KeyMods = {}): ToyState | null {
  if (mods.altKey === true || mods.ctrlKey === true || mods.metaKey === true) return null;
  const i = TOY_STATES.indexOf(current);
  const n = TOY_STATES.length;
  if (key === "ArrowRight" || key === "ArrowDown") return TOY_STATES[(i + 1) % n];
  if (key === "ArrowLeft" || key === "ArrowUp") return TOY_STATES[(i - 1 + n) % n];
  if (key === "Home") return TOY_STATES[0];
  if (key === "End") return TOY_STATES[n - 1];
  return null;
}

export interface StateToyProps {
  value: ToyState;
  onChange: (next: ToyState) => void;
}

export function StateToy({ value, onChange }: StateToyProps) {
  const group = useRef<HTMLDivElement>(null);

  // When the toy leaves the stage with a chip focused, focus goes to the section it sat in, not to the page.
  useLayoutEffect(() => {
    const g = group.current;
    return () => {
      if (g === null || !g.contains(document.activeElement)) return;
      g.closest<HTMLElement>("section[tabindex]")?.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = toyKeyStep(value, e.key, e);
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    group.current?.querySelector<HTMLElement>(`[data-toy="${next}"]`)?.focus();
  };

  return (
    <div ref={group} role="radiogroup" aria-label={LANDING.stage.toyLabel} data-state-toy="" onKeyDown={onKeyDown} className="demo-toy-grid">
      {TOY_STATES.map((state, i) => {
        const on = state === value;
        return (
          <button
            key={state}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-toy={state}
            data-on={on ? "true" : "false"}
            onClick={() => onChange(state)}
            style={{ "--i": i } as CSSProperties}
            className={`${TARGET} ${FOCUS} demo-toy-chip relative inline-flex items-center justify-center gap-2 rounded-chip px-4 text-sm ${
              on ? "mat-brass border border-brass-hi font-medium" : "mat-glass border-brass! text-ink hover:text-brass-hi"
            }`}
          >
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 16 16"
              className="pointer-events-none size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {GLYPH[state]}
            </svg>
            {LANDING.stage.toy[state]}
          </button>
        );
      })}
    </div>
  );
}
