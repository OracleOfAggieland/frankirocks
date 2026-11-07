import { describe, expect, it } from "vitest";
import { CUES, MAX_CUE_GAIN, scoreFor, scoreLengthMs } from "./score";

describe("cue scores", () => {
  it.each(CUES)("%s stays at or below the peak gain", (cue) => {
    const notes = scoreFor(cue);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n.peakGain).toBeLessThanOrEqual(MAX_CUE_GAIN);
  });

  it("wake is three rising notes with a crackle, under 1.5 s", () => {
    const notes = scoreFor("wake");
    expect(notes.filter((n) => n.type === "sine").map((n) => n.freq)).toEqual([330, 440, 660]);
    expect(notes.some((n) => n.type === "noise")).toBe(true);
    expect(scoreLengthMs(notes)).toBeLessThan(1500);
  });

  it("thinking is a faint 400 ms crackle, card an 80 ms tap", () => {
    expect(scoreFor("thinking")).toEqual([expect.objectContaining({ type: "noise", durMs: 400 })]);
    expect(scoreFor("card")).toEqual([expect.objectContaining({ type: "triangle", durMs: 80 })]);
    expect(scoreFor("thinking")[0].peakGain).toBeLessThan(0.05);
  });

  it("returns a fresh copy each time", () => {
    const a = scoreFor("card");
    a[0].peakGain = 1;
    expect(scoreFor("card")[0].peakGain).toBeLessThanOrEqual(MAX_CUE_GAIN);
  });
});
