import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbVisitActions, runVisit } from "./visit-testing";

// Brief 027, property "The clock only goes forward".
describe("Property: the clock only goes forward", () => {
  it("never asks advance for a time at or before the world clock it last saw", () => {
    fc.assert(
      fc.property(arbVisitActions, (actions) => {
        for (const step of runVisit(actions).steps) {
          for (const c of step.commands) {
            if (c.kind !== "advance") continue;
            // Before any answer the client knows no world clock, so it may not ask for one.
            expect(step.lastSeenBefore).not.toBeNull();
            expect(c.toMs).toBeGreaterThan(step.lastSeenBefore!);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
