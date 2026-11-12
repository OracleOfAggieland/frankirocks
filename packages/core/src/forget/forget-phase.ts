/**
 * @machine forget.job
 * The phase a forget job moves to after each step (spec §8; contracts §1 ForgetJob, §8). Always: phases only move
 * forward, in the spec's order, and `done` is the only phase that maps to itself. Never: this part runs a phase
 * that is not built. The executor runs `close`, `resolve` and `install`, and stops in `closure` (FORGET_STOP_PHASE):
 * closure, resume and purge are reserved for a later part, so no forget built here can reach `done`.
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

export function nextForgetPhase(p: ForgetPhase): ForgetPhase {
  return NEXT[p] ?? "done";
}

/** True when this part's executor may run phase `p`. */
export function forgetPhaseBuilt(p: ForgetPhase): boolean {
  return BUILT[p] ?? false;
}
