// Brief 050 part C: the number helpers the report uses. Pure.

/** A p95 over fewer values than this is printed as "n too small" and stored as null. */
export const MIN_N_FOR_P95 = 20;

/** Finite numbers only; strings, nulls and NaN are dropped. */
export function numbers(values) {
  return values.filter((v) => typeof v === "number" && Number.isFinite(v));
}

/** Nearest-rank percentile, the same rule as `percentile` in packages/core/src/voice/latency.ts. Null for no values. */
export function percentile(values, p) {
  const xs = numbers(values);
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** Count, p50, p95 (null under MIN_N_FOR_P95), largest and smallest, rounded to whole ms. */
export function describe(values) {
  const xs = numbers(values);
  const n = xs.length;
  if (n === 0) return { n: 0, p50: null, p95: null, max: null, min: null, smallN: true };
  return {
    n,
    p50: round(percentile(xs, 50)),
    p95: n >= MIN_N_FOR_P95 ? round(percentile(xs, 95)) : null,
    max: round(Math.max(...xs)),
    min: round(Math.min(...xs)),
    smallN: n < MIN_N_FOR_P95,
  };
}

export function round(v) {
  return v === null || v === undefined ? null : Math.round(v);
}

/** Share as a fraction with 3 decimals; null when the denominator is 0. */
export function share(part, whole) {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 1000;
}

export function sum(values) {
  return numbers(values).reduce((a, b) => a + b, 0);
}

/** Groups items by a key function, keeping first-seen order. */
export function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

/** Counts of a string field, as a plain object sorted by count. */
export function countBy(items, keyOf) {
  const out = {};
  for (const item of items) {
    const key = String(keyOf(item));
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}
