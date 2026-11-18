import Link from "next/link";
import type { AuthState } from "../client/auth";
import { COPY } from "../ui/copy";
import { AccountMenu } from "./AccountMenu";
import { FOCUS, TARGET } from "./surfaces/classes";

/** The large brass sign-in button: something you can touch, pressed 2 px on press. */
const SIGN_IN = `${TARGET} ${FOCUS} mat-brass inline-flex h-14 items-center justify-center gap-2.5 rounded-chip pl-6 pr-7 text-base font-medium transition-[transform,filter] duration-(--dur-quick) hover:brightness-110 active:translate-y-0.5 disabled:opacity-50 disabled:hover:brightness-100`;

/** The quiet link to the front door, under the sign-in button. */
const ABOUT = `${TARGET} ${FOCUS} inline-flex items-center rounded-control px-3 text-sm text-ink-dim underline decoration-ink-dim/50 underline-offset-4 transition-colors duration-(--dur-quick) hover:text-ink hover:decoration-ink`;

/** A lightning bolt in night-0 on the brass: the spark that wakes Franki. Decorative. */
function BoltGlyph() {
  return (
    <svg viewBox="0 0 14 20" aria-hidden="true" focusable="false" data-sign-in-bolt="" className="h-5 w-3.5 shrink-0">
      <path d="M8.9 1 L1.6 11.3 H6.5 L5.1 19 L12.4 8.4 H7.5 Z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

export interface AuthPanelProps {
  state: AuthState;
  /** True while a popup is open, so a second press does nothing. */
  busy: boolean;
  /** Set when the public Firebase config is incomplete: the missing variable names, never values. */
  configMissing: string[] | null;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Deletes everything stored for the user and their sign-in; true once done. */
  onDeleteAccount: () => Promise<boolean>;
}

/**
 * Sign-in control and signed-in identity (FSC R9.1, R9.2, R9.4, R9.6, R9.7; lab-ui-foundation R13.1,
 * R13.4, R13.5, R14.9). Signed out: one brass "Sign in to wake Franki" button for the same Google
 * sign-in, disabled until Firebase reports and while a popup is open, with any error inline, and under it a
 * quiet link to the front door. Signed in: the account menu (the email in mono 12; Sign out and Delete my data),
 * for the header rail.
 * Presentational only.
 */
export function AuthPanel({ state, busy, configMissing, onSignIn, onSignOut, onDeleteAccount }: AuthPanelProps) {
  if (configMissing !== null) {
    return (
      <section aria-label="Sign-in" className="flex flex-col items-center gap-2">
        <p role="alert" className="text-sm text-ember">
          Sign-in is not configured. Missing: {configMissing.join(", ")}.
        </p>
        <Link href="/" className={ABOUT}>
          {COPY.auth.about}
        </Link>
      </section>
    );
  }
  if (state.kind === "signedIn") {
    return (
      <section aria-label="Signed in" className="flex min-w-0 items-center gap-3">
        <AccountMenu email={state.email} onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} />
      </section>
    );
  }
  const error = state.kind === "signedOut" ? state.error : null;
  return (
    <section aria-label="Sign-in" className="flex flex-col items-center gap-2">
      <button type="button" onClick={onSignIn} disabled={state.kind === "loading" || busy} className={SIGN_IN}>
        <BoltGlyph />
        {COPY.auth.signIn}
      </button>
      {state.kind === "loading" ? <p className="text-xs text-ink-dim">Checking sign-in…</p> : null}
      {error !== null ? (
        <p role="alert" data-cause={error.cause} className="max-w-[343px] text-sm text-ember">
          {error.message}
        </p>
      ) : null}
      <Link href="/" className={ABOUT}>
        {COPY.auth.about}
      </Link>
    </section>
  );
}
