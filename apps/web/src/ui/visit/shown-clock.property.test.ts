// Brief 038, new property 5: a shown clock is labelled by the server's word. For any run of the visit (answers
// delivered, failed, timed out, live and stale, reloads, retries, start overs and bolt presses) and any real clock,
// the badge shows a clock only when the server has said which clock the account runs on, and shows it as simulated
// exactly when that is the fixture clock: the world clock the server gave, never the real one in its place.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { badgeFor } from "./visit-machine";
import { arbVisitActions, runVisit } from "./visit-testing";

describe("Property: a shown clock is labelled by the server's word (brief 038)", () => {
  it("shows a clock only once the server has said the mode, and simulated exactly on the fixture clock", () => {
    fc.assert(
      fc.property(arbVisitActions, fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }), (actions, real) => {
        for (const step of runVisit(actions).steps) {
          const badge = badgeFor(step.state, real, "America/Chicago");
          if (step.said === null) {
            expect(badge, `${step.event.kind} -> ${step.state.phase}`).toBeNull();
            continue;
          }
          expect(badge, `${step.event.kind} -> ${step.state.phase}`).not.toBeNull();
          expect(badge!.simulated).toBe(step.said.mode === "fixture");
          expect(badge!.instantMs).toBe(step.said.mode === "fixture" ? step.said.worldMs : real);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
