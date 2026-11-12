// Property (brief 015, ui.dockLayout): over any run of renders and exits, a card that shows always has the
// dock column, the column goes only on a completed exit, and with no card one completed exit always clears it.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type DockLayout, type DockLayoutEvent, dockLayoutInit, dockLayoutStep, hasDockColumn } from "./dock-layout";

const event: fc.Arbitrary<DockLayoutEvent> = fc.oneof(
  fc.boolean().map((present): DockLayoutEvent => ({ type: "cards", present })),
  fc.constant<DockLayoutEvent>({ type: "exitComplete" }),
);

describe("ui.dockLayout property", () => {
  it("never hides a showing card's column and is never stuck in it", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(event, { maxLength: 40 }), (first, events) => {
        let layout: DockLayout = dockLayoutInit(first);
        let present = first;
        expect(hasDockColumn(layout)).toBe(present);
        for (const e of events) {
          const before = layout;
          layout = dockLayoutStep(layout, e);
          if (e.type === "cards") present = e.present;
          if (present) expect(layout).toBe("dock");
          if (hasDockColumn(before) && !hasDockColumn(layout)) expect(e.type).toBe("exitComplete");
          if (!present) expect(dockLayoutStep(layout, { type: "exitComplete" })).toBe("center");
        }
      }),
      { numRuns: 1000 },
    );
  });
});
