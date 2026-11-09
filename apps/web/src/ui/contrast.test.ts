import { describe, expect, it } from "vitest";
import { COLOR } from "./motion";
import { MIN_RATIO, PAIRINGS, contrastRatio, pairingRatio } from "./contrast";

describe("token contrast (R18.4)", () => {
  it("computes known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  it.each(PAIRINGS.map((p) => [`${p.foreground} on ${p.background} (${p.use})`, p] as const))(
    "%s meets WCAG 2.2 AA",
    (_name, p) => {
      expect(pairingRatio(p)).toBeGreaterThanOrEqual(MIN_RATIO[p.use]);
    },
  );

  it("never lists stitch as a control boundary (contract question 6)", () => {
    expect(PAIRINGS.some((p) => p.foreground === "stitch" && p.use === "control boundary")).toBe(false);
    expect(contrastRatio(COLOR.stitch, COLOR["night-0"])).toBeLessThan(3);
  });
});
