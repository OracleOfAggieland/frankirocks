import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { shownClock, visitBadge } from "./visit-machine";
import { arbVisitActions, runVisit } from "./visit-testing";

// Brief 027, property "A simulated time is always labeled".
describe("Property: a simulated time is always labeled", () => {
  it("shows the badge, with the shown time, whenever the shown clock differs from the real one", () => {
    fc.assert(
      fc.property(arbVisitActions, fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }), fc.boolean(), (actions, real0, sameAsWorld) => {
        for (const step of runVisit(actions).steps) {
          const real = sameAsWorld && step.state.worldMs !== null ? step.state.worldMs : real0;
          const shown = shownClock(step.state, real);
          const badge = visitBadge(step.state, real, "America/Chicago");
          if (shown !== real) {
            expect(badge.simulated).toBe(true);
            expect(badge.instantMs).toBe(shown);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
