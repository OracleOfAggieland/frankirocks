/**
 * @machine ui.ringSpark
 * The call button's ring spark (lab-ui-foundation R10.3, R10.4): one spark around the start ring per press,
 * only with Reduced_Motion off and an Electricity grant. Pure: ringSparkStep(state, event).
 * Always: a grant is held only in `sparking`, and the spark drawn is keyed by that grant's token.
 * Never:  read the budget, a clock or the DOM; throw. Asking for a grant and giving one back are commands
 *         the shell runs against the screen's Electricity budget.
 */

export type RingSpark = { readonly mode: "idle" } | { readonly mode: "sparking"; readonly token: number };

export type RingSparkEvent =
  /** A pointer press on the call button. `start`: the button shows its start form. */
  | { readonly type: "pressed"; readonly start: boolean; readonly reduced: boolean }
  /** The budget's answer to a `request` command: a grant token, or null when the budget is full. */
  | { readonly type: "granted"; readonly token: number | null }
  /** The spark span's animation ended or was cancelled; `token` is the span's key. */
  | { readonly type: "animationEnd"; readonly token: number }
  | { readonly type: "animationCancel"; readonly token: number }
  /** The button left its start form (a call started), so the spark span is gone. */
  | { readonly type: "formLeft" }
  /** Reduced_Motion turned on, so the spark's animation is removed. */
  | { readonly type: "reducedOn" }
  /** The call controls unmounted (sign-out swaps the screen). */
  | { readonly type: "unmount" };

export type RingSparkCommand = { readonly kind: "request" } | { readonly kind: "release"; readonly token: number };

export interface RingSparkStep {
  readonly state: RingSpark;
  readonly commands: readonly RingSparkCommand[];
}

export const RING_SPARK_IDLE: RingSpark = { mode: "idle" };

const stay = (state: RingSpark): RingSparkStep => ({ state, commands: [] });
const release = (token: number): RingSparkStep => ({ state: RING_SPARK_IDLE, commands: [{ kind: "release", token }] });

export function ringSparkStep(state: RingSpark, event: RingSparkEvent): RingSparkStep {
  switch (event.type) {
    case "pressed":
      if (state.mode !== "idle" || !event.start || event.reduced) return stay(state);
      return { state, commands: [{ kind: "request" }] };
    case "granted":
      if (event.token === null) return stay(state);
      // A second grant while one is held is not kept: it goes straight back.
      if (state.mode === "sparking") return { state, commands: [{ kind: "release", token: event.token }] };
      return stay({ mode: "sparking", token: event.token });
    case "animationEnd":
      return state.mode === "sparking" && state.token === event.token ? release(state.token) : stay(state);
    case "animationCancel":
      return state.mode === "sparking" && state.token === event.token ? release(state.token) : stay(state);
    case "formLeft":
      // The click that follows the press starts a call and removes the span, so no end will come.
      return state.mode === "sparking" ? release(state.token) : stay(state);
    case "reducedOn":
      return stay(state);
    case "unmount":
      return stay(state);
    default:
      event satisfies never;
      return stay(state);
  }
}
