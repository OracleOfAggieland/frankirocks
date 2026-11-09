// Level computation for the Level_Meter (lab-ui-foundation R11.1, R11.6). Pure.

/** Speech rarely reaches full-scale RMS; this gain maps normal speech to most of 0..1. */
export const LEVEL_GAIN = 4;
export const ATTACK = 0.5;
export const RELEASE = 0.12;

const unit = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) + 0 : 0);

/** RMS of 8-bit time-domain samples centred on 128, scaled and clamped to 0..1. Empty or invalid input gives 0. */
export function rawLevel(samples: ArrayLike<number>): number {
  const n = samples?.length ?? 0;
  if (!Number.isInteger(n) || n <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > 255) return 0;
    const centred = (s - 128) / 128;
    sum += centred * centred;
  }
  return unit(Math.sqrt(sum / n) * LEVEL_GAIN);
}

/** One smoothing step: attack 0.5 when rising, release 0.12 when falling. Result is in 0..1; a non-finite prev counts as 0. */
export function smoothLevel(prev: number, raw: number): number {
  const p = unit(prev);
  const r = unit(raw);
  const k = r > p ? ATTACK : RELEASE;
  return unit(p + (r - p) * k);
}

export function levelFrom(samples: ArrayLike<number>, prev: number): number {
  return smoothLevel(prev, rawLevel(samples));
}
