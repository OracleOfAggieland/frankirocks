/**
 * The Latency_Clock (voice-control R18; design "The Latency_Clock", question 83). Pure: every time is the browser
 * opsClock in milliseconds, recorded by the Voice_Machine. Nothing here goes on the wire (R18.4).
 */

/** The Voice_Client samples the mic analyser this often for the last loud frame. */
export const LATENCY_SAMPLE_MS = 20;
/**
 * An unsmoothed `rawLevel` at or above this is speech: the spike's SPEECH_RMS_THRESHOLD (400 of 32,767) times the
 * Level_Meter's LEVEL_GAIN of 4. The analyser reads 8-bit samples, so this is only roughly the spike's line.
 */
export const LOUD_LEVEL = 0.05;
/** A Permit later than commit + this marks the turn late; it still plays (design review change 2). */
export const LATE_TURN_MS = 2_500;
/** Rows kept for the Session's summary. */
export const MAX_LATENCY_ROWS = 50;

export type LatencyPath = "fastO" | "regenerated" | "slow" | "recovery";
export const LATENCY_PATHS: readonly LatencyPath[] = ["fastO", "regenerated", "slow", "recovery"];

/** Why a turn with a verdict didn't take `fastO` (R18.6). */
export type FastORefusal = "verdict" | "ack" | "outstanding" | "staleAck" | "noteWaiting" | "hash";
export const FAST_O_REFUSALS: readonly FastORefusal[] = ["verdict", "ack", "outstanding", "staleAck", "noteWaiting", "hash"];

export interface LatencyTimes {
  turnId: string;
  lastLoud: number | null;
  commit: number | null;
  judgeSent: number | null;
  verdict: "O" | "H" | "U" | null;
  verdictAt: number | null;
  firstMuted: number | null;
  permitAt: number | null;
  audible: number | null;
  path: LatencyPath | null;
  refused: FastORefusal | null;
}

export interface LatencyRow extends LatencyTimes {
  late: boolean;
  commitDelayMs: number | null;
  endToAudibleMs: number | null;
}

export function emptyTimes(turnId: string): LatencyTimes {
  return { turnId, lastLoud: null, commit: null, judgeSent: null, verdict: null, verdictAt: null, firstMuted: null, permitAt: null, audible: null, path: null, refused: null };
}

const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : b - a);

/** The row with its derived fields. */
export function finishRow(t: LatencyTimes): LatencyRow {
  return {
    ...t,
    late: t.permitAt !== null && t.commit !== null && t.permitAt > t.commit + LATE_TURN_MS,
    commitDelayMs: diff(t.lastLoud, t.commit),
    endToAudibleMs: diff(t.lastLoud, t.audible),
  };
}

/** Appends a row, keeping the newest MAX_LATENCY_ROWS. */
export function pushRow(rows: readonly LatencyRow[], row: LatencyRow): LatencyRow[] {
  return [...rows, row].slice(-MAX_LATENCY_ROWS);
}

/** Nearest-rank percentile; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

export interface LatencySummary {
  byPath: { path: LatencyPath; n: number; p50: number | null; p95: number | null }[];
  refused: { reason: FastORefusal; n: number }[];
  late: number;
}

/** Per path, the p50 and p95 of end of audible speech to audible start; counts of refusals and late turns. */
export function summarize(rows: readonly LatencyRow[]): LatencySummary {
  return {
    byPath: LATENCY_PATHS.map((path) => {
      const ms = rows.filter((r) => r.path === path && r.endToAudibleMs !== null).map((r) => r.endToAudibleMs!);
      return { path, n: rows.filter((r) => r.path === path).length, p50: percentile(ms, 50), p95: percentile(ms, 95) };
    }),
    refused: FAST_O_REFUSALS.map((reason) => ({ reason, n: rows.filter((r) => r.refused === reason).length })),
    late: rows.filter((r) => r.late).length,
  };
}
