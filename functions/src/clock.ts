/**
 * Ops clock for scheduled functions. On the clock allow-list (scripts/clock-allowlist.json).
 */
export function opsNowMs(): number {
  return Date.now();
}
