/**
 * Ops clock for the heartbeat function. On the clock allow-list (scripts/clock-allowlist.json).
 * `functions` does not import packages/server, so it has its own one-function clock file.
 */
export function opsNowMs(): number {
  return Date.now();
}
