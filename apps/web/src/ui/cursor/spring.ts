// A damped spring on one number, stepped by Frame_Time. Pure. Stiffness and damping are the motion
// library's units (mass 1, per second), so SPRING.float, SPRING.settle and SPRING.press feel the same here.
import type { Spring } from "../motion";

export interface SpringValue {
  readonly x: number;
  readonly v: number;
}

/** Sub-steps are at most this long, so the stiffest spring stays stable on a slow frame. */
const SUBSTEP_MS = 4;

export const at = (x: number): SpringValue => ({ x, v: 0 });

export function stepSpring(s: SpringValue, target: number, spring: Spring, dtMs: number): SpringValue {
  if (dtMs <= 0) return s;
  const n = Math.ceil(dtMs / SUBSTEP_MS);
  const h = dtMs / n / 1000;
  let { x, v } = s;
  for (let i = 0; i < n; i++) {
    v += (-spring.stiffness * (x - target) - spring.damping * v) * h;
    x += v * h;
  }
  return { x, v };
}
