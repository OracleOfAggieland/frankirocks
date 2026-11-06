import type { AuthState } from "../client/auth";

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
 * Sign-in control and signed-in identity (R9.1, R9.2, R9.4, R9.6, R9.7). Presentational only.
 * While `loading`, the sign-in control shows but stays disabled until Firebase reports whether a user exists.
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
      <section aria-label="Signed in" className="flex items-center gap-3">
        <span data-testid="signed-in-email" className="text-sm text-ink">
          {state.email}
        </span>
        <button type="button" onClick={onSignOut} className="rounded border border-ink-dim px-3 py-1 text-sm hover:bg-night-2">
          Sign out
        </button>
      </section>
    );
  }
  const error = state.kind === "signedOut" ? state.error : null;
  return (
    <section aria-label="Sign-in" className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onSignIn}
        disabled={state.kind === "loading" || busy}
        className="rounded bg-brass px-4 py-2 font-medium text-night-0 disabled:opacity-50"
      >
        Sign in with Google
      </button>
      {state.kind === "loading" ? <p className="text-xs text-ink-dim">Checking sign-in…</p> : null}
      {error !== null ? (
        <p role="alert" data-cause={error.cause} className="max-w-sm text-sm text-ember">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
