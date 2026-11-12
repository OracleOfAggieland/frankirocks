import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Seen, nextSeen } from "./seen";

const T = 0.6;

describe("nextSeen", () => {
  it("a first report in view is seen, whatever share shows", () => {
    expect(nextSeen(undefined, { first: true, isIntersecting: true, ratio: 0.01 }, T)).toBe("seen");
  });

  it("a first report out of view is waiting", () => {
    expect(nextSeen(undefined, { first: true, isIntersecting: false, ratio: 0 }, T)).toBe("waiting");
  });

  it("a later report becomes seen only at the threshold", () => {
    expect(nextSeen("waiting", { first: false, isIntersecting: true, ratio: T - 0.01 }, T)).toBe("waiting");
    expect(nextSeen("waiting", { first: false, isIntersecting: true, ratio: T }, T)).toBe("seen");
  });

  it("seen is never undone", () => {
    expect(nextSeen("seen", { first: false, isIntersecting: false, ratio: 0 }, T)).toBe("seen");
  });

  it("once seen, no sequence of reports returns anything else", () => {
    const report = fc.record({ first: fc.boolean(), isIntersecting: fc.boolean(), ratio: fc.double({ min: 0, max: 1, noNaN: true }) });
    fc.assert(
      fc.property(fc.array(report, { minLength: 1, maxLength: 30 }), fc.double({ min: 0, max: 1, noNaN: true }), (reports, threshold) => {
        let s: Seen | undefined;
        let wasSeen = false;
        reports.forEach((r, i) => {
          s = nextSeen(s, { ...r, first: i === 0 }, threshold);
          if (wasSeen) expect(s).toBe("seen");
          if (s === "seen") wasSeen = true;
          expect(s).not.toBe("static");
        });
      }),
    );
  });
});
