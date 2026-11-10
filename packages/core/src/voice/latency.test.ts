import { describe, expect, it } from "vitest";
import { LATENCY_SAMPLE_MS, LOUD_LEVEL, MAX_LATENCY_ROWS, emptyTimes, finishRow, percentile, pushRow, summarize } from "./latency";

const row = (over: Partial<ReturnType<typeof emptyTimes>>) => finishRow({ ...emptyTimes("t"), ...over });

describe("Latency_Clock", () => {
  it("derives commit delay, end to audible and late", () => {
    const r = row({ lastLoud: 1_000, commit: 1_480, permitAt: 1_900, audible: 2_300, path: "fastO" });
    expect(r).toMatchObject({ commitDelayMs: 480, endToAudibleMs: 1_300, late: false });
    expect(row({ commit: 1_000, permitAt: 3_500 }).late).toBe(false);
    expect(row({ commit: 1_000, permitAt: 3_501 }).late).toBe(true);
    expect(row({ commit: null, permitAt: 9_000 }).late).toBe(false);
    expect(row({}).endToAudibleMs).toBeNull();
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([3, 1], 50)).toBe(1);
    expect(percentile([3, 1], 95)).toBe(3);
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(twenty, 50)).toBe(10);
    expect(percentile(twenty, 95)).toBe(19);
  });

  it("summarizes by path, refusal and lateness", () => {
    const rows = [
      row({ lastLoud: 0, audible: 1_200, path: "fastO" }),
      row({ lastLoud: 0, audible: 1_400, path: "fastO" }),
      row({ lastLoud: 0, audible: 2_000, path: "slow", refused: "ack" }),
      row({ commit: 0, permitAt: 3_000, path: "slow", refused: "outstanding" }),
      row({ path: "recovery" }),
    ];
    const s = summarize(rows);
    expect(s.byPath).toEqual([
      { path: "fastO", n: 2, p50: 1_200, p95: 1_400 },
      { path: "regenerated", n: 0, p50: null, p95: null },
      { path: "slow", n: 2, p50: 2_000, p95: 2_000 },
      { path: "recovery", n: 1, p50: null, p95: null },
    ]);
    expect(s.refused.find((x) => x.reason === "ack")!.n).toBe(1);
    expect(s.refused.find((x) => x.reason === "outstanding")!.n).toBe(1);
    expect(s.late).toBe(1);
  });

  it("keeps the newest 50 rows and names its constants", () => {
    let rows: ReturnType<typeof row>[] = [];
    for (let i = 0; i < 60; i++) rows = pushRow(rows, row({ commit: i }));
    expect(rows).toHaveLength(MAX_LATENCY_ROWS);
    expect(rows[0]!.commit).toBe(10);
    expect(LOUD_LEVEL).toBe(0.05);
    expect(LATENCY_SAMPLE_MS).toBe(20);
  });
});
