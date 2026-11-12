import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbVisitActions, runVisit } from "./visit-testing";

// Brief 027, property "One clone per visit".
describe("Property: one clone per visit", () => {
  it("calls reset at most once per stored visit ID, plus once per time the visitor asks", () => {
    fc.assert(
      fc.property(arbVisitActions, (actions) => {
        const resets = new Map<string, number>();
        const asks = new Map<string, number>();
        const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
        for (const step of runVisit(actions).steps) {
          const asked = step.event.kind === "retry" || step.event.kind === "startOverConfirmed";
          if (asked && step.storedIdBefore !== null) bump(asks, step.storedIdBefore);
          for (const c of step.commands) if (c.kind === "reset") bump(resets, c.visitId);
        }
        for (const [id, n] of resets) expect(n, id).toBeLessThanOrEqual(1 + (asks.get(id) ?? 0));
      }),
      { numRuns: 1000 },
    );
  });

  it("stores the visit ID before its reset goes out, so a reload never makes a second one", () => {
    fc.assert(
      fc.property(arbVisitActions, (actions) => {
        for (const step of runVisit(actions).steps) {
          const reset = step.commands.findIndex((c) => c.kind === "reset");
          if (reset < 0) continue;
          const id = (step.commands[reset] as { visitId: string }).visitId;
          const stored = step.storedIdBefore === id || step.commands.slice(0, reset).some((c) => c.kind === "store" && c.visit.visitId === id);
          expect(stored).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
