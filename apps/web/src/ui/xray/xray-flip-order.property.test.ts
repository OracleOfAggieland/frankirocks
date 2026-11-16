// Property (brief 051, ui.xray): no step asks for a camera while one is open; flip (and every other event) tells the
// open camera to stop before it asks for the next one.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moveArb, runSteps } from "./testing/xray-arbitraries";

describe("ui.xray property", () => {
  it("stops the open camera before asking for another", () => {
    fc.assert(
      fc.property(fc.array(moveArb, { maxLength: 40 }), (moves) => {
        for (const { before, result } of runSteps(moves)) {
          let open = before.cameraOpen;
          for (const c of result.commands) {
            if (c.kind === "stopCamera") open = false;
            if (c.kind === "openCamera") expect(open).toBe(false);
          }
          expect(result.commands.filter((c) => c.kind === "openCamera").length).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
