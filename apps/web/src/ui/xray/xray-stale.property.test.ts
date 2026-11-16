// Property (brief 051, ui.xray): a camera or tracker report naming an older session never changes the state, and a
// late camera is handed back to be stopped at once.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moveArb, run, staleReportArb } from "./testing/xray-arbitraries";
import { xrayStep } from "./xray-machine";

describe("ui.xray property", () => {
  it("drops a stale report", () => {
    fc.assert(
      fc.property(fc.array(moveArb, { maxLength: 40 }), staleReportArb(), (moves, report) => {
        for (const s of run(moves)) {
          const e = report(s);
          const { state, commands } = xrayStep(s, e);
          expect(state).toBe(s);
          const late = e.kind === "camera" && e.report === "opened";
          expect(commands).toEqual(late ? [{ kind: "dropStream", session: e.session }] : []);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
