/**
 * Brief 050 part B: the runner page (`/live-test`, a second window) keeps the step in progress in localStorage, so
 * the recorder in the app's window can put it on words lines. Same origin, so both windows read one store.
 */
export const STEP_KEY = "franki.liveTest.step";

/** The step the runner has started and not ended, or null. Never throws. */
export function currentStepId(): string | null {
  try {
    const v = window.localStorage.getItem(STEP_KEY);
    return v === null || v === "" ? null : v;
  } catch {
    return null;
  }
}

export function saveStepId(step: string | null): void {
  try {
    if (step === null) window.localStorage.removeItem(STEP_KEY);
    else window.localStorage.setItem(STEP_KEY, step);
  } catch {
    // no storage: words lines carry no step
  }
}
