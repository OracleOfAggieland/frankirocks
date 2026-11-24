"use client";
// The signed-in account menu in the header rail. The trigger shows the email (mono 12) and a chevron; it opens a
// small menu with "Sign out" and "Delete my data". Delete opens a modal confirmation (a native <dialog>, so focus is
// held inside and Escape cancels) that says what goes and that it can't be undone; nothing is deleted until its
// own "Delete everything" is pressed. While the delete runs, neither button can be pressed again.
// Brief 054: on a demo visit the trigger shows the persona's name (passed as `email`) and a small "Demo" mark.
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { COPY } from "../ui/copy";
import { FOCUS, QUIET_BUTTON, TARGET } from "./surfaces/classes";

const TRIGGER = `${TARGET} ${FOCUS} inline-flex min-w-0 items-center gap-2 rounded-chip border border-ink-dim/70 px-4 text-sm text-ink transition-colors duration-(--dur-quick) hover:border-ink hover:bg-night-2 aria-expanded:border-ink aria-expanded:bg-night-2`;
const ITEM = `${TARGET} ${FOCUS} flex w-full items-center rounded-control px-3 text-left text-sm transition-colors duration-(--dur-quick) hover:bg-night-2 focus-visible:bg-night-2`;
const DANGER = `${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control bg-ember px-5 text-base font-medium text-night-0 transition-[transform,filter] duration-(--dur-quick) hover:brightness-110 active:translate-y-0.5 disabled:opacity-50 disabled:hover:brightness-100`;

/** The small mark beside the persona's name on a demo visit: brass linework, nothing filled. */
const DEMO_MARK = "shrink-0 rounded-chip border border-brass/70 px-2 font-mono text-xs leading-5 text-brass";

export interface AccountMenuProps {
  /** The signed-in email, or on a demo visit the persona's name. */
  email: string;
  /** Brief 054: a demo visit, marked as one beside the name. Absent for a signed-in owner, whose menu is unchanged. */
  demo?: boolean;
  onSignOut: () => void;
  /** Resolves true once everything is deleted (the screen then signs out), false if it didn't finish. */
  onDeleteAccount: () => Promise<boolean>;
}

type Phase = "idle" | "deleting" | "failed";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" className={`size-3 shrink-0 transition-transform duration-(--dur-quick) ${open ? "rotate-180" : ""}`}>
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AccountMenu({ email, demo = false, onSignOut, onDeleteAccount }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const titleId = useId();
  const bodyId = useId();

  // A press anywhere outside the menu closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current !== null && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    firstItem.current?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const closeMenu = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  // The native dialog is the only record of whether the confirmation is open, so it can't drift from what shows.
  const openConfirm = () => {
    const d = dialog.current;
    if (d === null) return;
    setPhase((p) => (p === "deleting" ? p : "idle"));
    if (!d.open) d.showModal();
    // Cancel first: the safe choice has focus, and the destructive one is never pre-selected.
    cancel.current?.focus();
  };

  const closeConfirm = () => {
    if (phase === "deleting") return;
    dialog.current?.close();
    setPhase("idle");
    // Back to the menu button, not to the menu item that opened the dialog, which is gone.
    trigger.current?.focus();
  };

  const runDelete = async () => {
    if (phase === "deleting") return;
    setPhase("deleting");
    const done = await onDeleteAccount();
    // On success the screen signs out and this menu goes with it.
    if (!done) setPhase("failed");
  };

  return (
    <div ref={root} data-account-menu="" className="relative min-w-0">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={demo ? `${COPY.account.menu}: ${email}, ${COPY.demo.mark}` : `${COPY.account.menu}: ${email}`}
        onClick={() => setOpen((o) => !o)}
        className={TRIGGER}
      >
        <span data-testid="signed-in-email" className="truncate font-mono text-xs text-ink-dim">
          {email}
        </span>
        {demo ? (
          <span data-demo-mark="" aria-hidden="true" className={DEMO_MARK}>
            {COPY.demo.mark}
          </span>
        ) : null}
        <Chevron open={open} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={COPY.account.menu}
          onKeyDown={onMenuKey}
          className="mat-glass absolute top-full right-0 z-30 mt-2 flex w-56 flex-col gap-1 rounded-card p-1.5"
        >
          <button
            ref={firstItem}
            type="button"
            role="menuitem"
            data-action="sign-out"
            className={`${ITEM} text-ink`}
            onClick={() => {
              closeMenu(false);
              onSignOut();
            }}
          >
            {COPY.auth.signOut}
          </button>
          <button
            type="button"
            role="menuitem"
            data-action="delete-account"
            className={`${ITEM} text-ember`}
            onClick={() => {
              closeMenu(false);
              openConfirm();
            }}
          >
            {COPY.account.delete}
          </button>
        </div>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-account-delete=""
        data-phase={phase}
        onCancel={(e) => {
          e.preventDefault();
          closeConfirm();
        }}
        // The browser may close it on its own (a repeated Escape can't be cancelled): the next open starts fresh.
        onClose={() => setPhase((p) => (p === "deleting" ? p : "idle"))}
        className="mat-glass m-auto w-[343px] max-w-[calc(100vw-2rem)] rounded-card p-5 text-left text-ink backdrop:bg-night-0/70 sm:w-md"
      >
        <h2 id={titleId} className="text-lg text-ink">
          {COPY.account.title}
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-ink-dim">
          {COPY.account.body}
        </p>
        <p className="mt-3 truncate font-mono text-xs text-ink-dim">{email}</p>
        {phase === "failed" ? (
          <p role="alert" className="mt-3 text-sm text-ember">
            {COPY.account.failed}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={cancel} type="button" data-action="delete-cancel" className={QUIET_BUTTON} disabled={phase === "deleting"} onClick={closeConfirm}>
            {COPY.account.cancel}
          </button>
          <button type="button" data-action="delete-confirm" className={DANGER} disabled={phase === "deleting"} onClick={() => void runDelete()}>
            {phase === "deleting" ? COPY.account.deleting : COPY.account.confirm}
          </button>
        </div>
      </dialog>
    </div>
  );
}
