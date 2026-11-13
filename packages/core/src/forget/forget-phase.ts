/**
 * @machine forget.job
 * The phase a forget job moves to after each step (spec §8; contracts §1 ForgetJob, §8). Always: phases only move
 * forward, in the spec's order, and `done` is the only phase that maps to itself. Since brief 047 the executor runs
 * every phase from `close` through `purge` (`forgetPhaseRuns`); `fence` is written by the fence's own transaction.
 */
import type { Job } from "../schema/records";

export type ForgetPhase = Extract<Job["payload"], { kind: "forget" }>["phase"];

const NEXT = {
  fence: "close",
  close: "resolve",
  resolve: "install",
  install: "closure",
  closure: "resume",
  resume: "purge",
  purge: "done",
  done: "done",
} as const satisfies Record<ForgetPhase, ForgetPhase>;

/** The phases this part's executor runs. */
const BUILT = {
  fence: false,
  close: true,
  resolve: true,
  install: true,
  closure: false,
  resume: false,
  purge: false,
  done: false,
} as const satisfies Record<ForgetPhase, boolean>;

/** Where the executor stops, with the job `blocked` (brief 021: "a phase that is not complete"). */
export const FORGET_STOP_PHASE: ForgetPhase = "closure";

/**
 * The phases the executor runs since brief 047: every phase but `fence` (written by the fence's own transaction) and
 * `done`. `BUILT` and `FORGET_STOP_PHASE` above record part one's table and are kept only for its committed
 * transition test; the executor reads this table.
 */
const RUNS = {
  fence: false,
  close: true,
  resolve: true,
  install: true,
  closure: true,
  resume: true,
  purge: true,
  done: false,
} as const satisfies Record<ForgetPhase, boolean>;

/** True when the executor runs phase `p`. */
export function forgetPhaseRuns(p: ForgetPhase): boolean {
  return RUNS[p] ?? false;
}

export function nextForgetPhase(p: ForgetPhase): ForgetPhase {
  return NEXT[p] ?? "done";
}

/** True when this part's executor may run phase `p`. */
export function forgetPhaseBuilt(p: ForgetPhase): boolean {
  return BUILT[p] ?? false;
}
