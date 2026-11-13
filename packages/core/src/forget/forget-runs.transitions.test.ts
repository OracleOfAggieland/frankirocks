import { describe, expect, it } from "vitest";
import { type ForgetPhase, forgetPhaseRuns, nextForgetPhase } from "./forget-phase";

const ORDER: ForgetPhase[] = ["fence", "close", "resolve", "install", "closure", "resume", "purge", "done"];

describe("forget.job since brief 047", () => {
  it("the executor runs close through purge; fence is the fence's own write and done runs nothing", () => {
    expect(ORDER.filter(forgetPhaseRuns)).toEqual(["close", "resolve", "install", "closure", "resume", "purge"]);
  });

  it("every phase the executor runs moves forward, and the last reaches done", () => {
    for (const p of ORDER.filter(forgetPhaseRuns)) expect(ORDER.indexOf(nextForgetPhase(p))).toBe(ORDER.indexOf(p) + 1);
    expect(nextForgetPhase("purge")).toBe("done");
  });
});
