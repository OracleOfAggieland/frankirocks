// The receipt's feed (brief 015 package E): a slip that prints upward out of its slot in eight steps, the way
// a printer feeds paper, each step a short push and a pause. Pure keyframes for `motion`; the duration of the
// whole feed comes from `DUR.ritual` in the component.

/** How many pushes the slip takes to come all the way out. */
export const FEED_STEPS = 8;

/** The share of each step spent moving; the rest is the pause while the line prints. */
export const FEED_MOVE = 0.55;

export interface FeedKeyframes {
  /** Vertical offsets as a share of the slip's own height: "100%" is still inside the slot, "0%" is out. */
  readonly y: string[];
  /** When each offset is reached, from 0 to 1 of the whole feed. */
  readonly times: number[];
  /** For each segment between two keyframes: true for a push, false for a pause. */
  readonly pushes: boolean[];
}

const pct = (share: number) => `${Math.round(share * 10000) / 100}%`;

export function feedKeyframes(steps = FEED_STEPS, move = FEED_MOVE): FeedKeyframes {
  const n = Math.max(1, Math.floor(steps));
  const m = Math.min(0.95, Math.max(0.05, move));
  const y = [pct(1)];
  const times = [0];
  const pushes: boolean[] = [];
  for (let k = 1; k <= n; k += 1) {
    const out = pct(1 - k / n);
    y.push(out, out);
    times.push((k - 1 + m) / n, k / n);
    pushes.push(true, false);
  }
  times[times.length - 1] = 1;
  return { y, times, pushes };
}
