// The dock layout's transitions (brief 015, ui.dockLayout): the grid keeps the dock column until the last
// card has dematerialized, and is never left in it while no card shows and no exit runs.
import { describe, expect, it } from "vitest";
import { type DockLayoutEvent, dockLayoutInit, dockLayoutStep, hasDockColumn } from "./dock-layout";

const cards = (present: boolean): DockLayoutEvent => ({ type: "cards", present });
const exitComplete: DockLayoutEvent = { type: "exitComplete" };

describe("ui.dockLayout", () => {
  it("starts from the cards on the first render", () => {
    expect(dockLayoutInit(false)).toBe("center");
    expect(dockLayoutInit(true)).toBe("dock");
  });

  it("CENTER + cards -> DOCK (the first card brings the column on the same render)", () => {
    expect(dockLayoutStep("center", cards(true))).toBe("dock");
  });

  it("DOCK + no cards -> LEAVING (the column stays while the last card dematerializes)", () => {
    const l = dockLayoutStep("dock", cards(false));
    expect(l).toBe("leaving");
    expect(hasDockColumn(l)).toBe(true);
  });

  it("LEAVING + exitComplete -> CENTER (the column goes once the dock has left)", () => {
    expect(dockLayoutStep("leaving", exitComplete)).toBe("center");
    expect(hasDockColumn("center")).toBe(false);
  });

  it("LEAVING + cards -> DOCK (cards that return during the exit keep the column)", () => {
    expect(dockLayoutStep("leaving", cards(true))).toBe("dock");
  });

  it("DOCK + exitComplete -> DOCK, CENTER + exitComplete -> CENTER (a stale exit changes nothing)", () => {
    expect(dockLayoutStep("dock", exitComplete)).toBe("dock");
    expect(dockLayoutStep("center", exitComplete)).toBe("center");
  });

  it("CENTER + no cards -> CENTER, LEAVING + no cards -> LEAVING (nothing new to show)", () => {
    expect(dockLayoutStep("center", cards(false))).toBe("center");
    expect(dockLayoutStep("leaving", cards(false))).toBe("leaving");
  });
});
