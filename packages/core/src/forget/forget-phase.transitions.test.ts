import { describe, expect, it } from "vitest";
import { FORGET_STOP_PHASE, type ForgetPhase, forgetPhaseBuilt, nextForgetPhase } from "./forget-phase";

const ORDER: ForgetPhase[] = ["fence", "close", "resolve", "install", "closure", "resume", "purge", "done"];

describe("forget.job", () => {
  it.each(ORDER.slice(0, -1).map((p, i) => [p, ORDER[i + 1]!] as const))("%s + step -> %s (spec §8 order)", (from, to) => {
    expect(nextForgetPhase(from)).toBe(to);
  });

  it("done + step -> done (terminal)", () => {
    expect(nextForgetPhase("done")).toBe("done");
  });

  it("the executor runs close, resolve and install only, and stops in closure (brief 021)", () => {
    expect(ORDER.filter(forgetPhaseBuilt)).toEqual(["close", "resolve", "install"]);
    expect(FORGET_STOP_PHASE).toBe("closure");
    expect(forgetPhaseBuilt(FORGET_STOP_PHASE)).toBe(false);
  });
});
