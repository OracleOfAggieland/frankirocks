import type { AuthState } from "../client/auth";
import { COPY } from "../ui/copy";
import { BRASS_BUTTON, QUIET_BUTTON } from "./surfaces/classes";

export interface AuthPanelProps {
  state: AuthState;
  /** True while a popup is open, so a second press does nothing. */
  busy: boolean;
  /** Set when the public Firebase config is incomplete: the missing variable names, never values. */
  configMissing: string[] | null;
  onSignIn: () => void;
  onSignOut: () => void;
}

/**
 * Sign-in control and signed-in identity (FSC R9.1, R9.2, R9.4, R9.6, R9.7; lab-ui-foundation R13.1,
 * R13.4, R13.5, R14.9). Signed out: one brass "Sign in to wake Franki" button for the same Google
 * sign-in, disabled until Firebase reports and while a popup is open, with any error inline. Signed in:
 * the email and "Sign out", for the header. Presentational only.
 */
export function AuthPanel({ state, busy, configMissing, onSignIn, onSignOut }: AuthPanelProps) {
  if (configMissing !== null) {
    return (
      <section aria-label="Sign-in" className="flex flex-col items-center gap-2">
        <p role="alert" className="text-sm text-ember">
          Sign-in is not configured. Missing: {configMissing.join(", ")}.
        </p>
      </section>
    );
  }
  if (state.kind === "signedIn") {
    return (
      <section aria-label="Signed in" className="flex min-w-0 items-center gap-3">
        <span data-testid="signed-in-email" className="truncate text-sm text-ink-dim">
          {state.email}
        </span>
        <button type="button" onClick={onSignOut} className={`${QUIET_BUTTON} text-sm`}>
          {COPY.auth.signOut}
        </button>
      </section>
    );
  }
  const error = state.kind === "signedOut" ? state.error : null;
  return (
    <section aria-label="Sign-in" className="flex flex-col items-center gap-2">
      <button type="button" onClick={onSignIn} disabled={state.kind === "loading" || busy} className={BRASS_BUTTON}>
        {COPY.auth.signIn}
      </button>
      {state.kind === "loading" ? <p className="text-xs text-ink-dim">Checking sign-in…</p> : null}
      {error !== null ? (
        <p role="alert" data-cause={error.cause} className="max-w-[343px] text-sm text-ember">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
