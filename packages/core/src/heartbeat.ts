/** Firestore locations used by the deploy smoke test. Only server code reads or writes them. */
export const SMOKE = {
  collection: "_smoke",
  heartbeatDoc: "heartbeat",
  webDoc: "web",
  /** The heartbeat function runs every 30 minutes; allow 5 minutes of scheduler slack. */
  heartbeatMaxAgeMs: 35 * 60 * 1000,
} as const;

/**
 * True when a heartbeat written at `beatAtMs` is still fresh at `nowMs`.
 * Clock skew can put a beat slightly in the future, so the window applies in both directions.
 */
export function isHeartbeatFresh(
  beatAtMs: number,
  nowMs: number,
  maxAgeMs: number = SMOKE.heartbeatMaxAgeMs,
): boolean {
  if (!Number.isFinite(beatAtMs) || !Number.isFinite(nowMs) || !(maxAgeMs >= 0)) return false;
  return Math.abs(nowMs - beatAtMs) <= maxAgeMs;
}
