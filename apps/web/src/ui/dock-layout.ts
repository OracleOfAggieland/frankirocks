/**
 * @machine ui.dockLayout
 * Whether the Main_Screen's grid has the Card_Dock's column (brief 015). Pure: dockLayoutStep(layout, event).
 * Always: the grid has the dock column from the first card (`dock`) until the last card's exit has finished
 *         (`leaving`, ended by `exitComplete`), so a card dematerializes before its column goes. Cards that
 *         return during the exit go straight back to `dock`. An `exitComplete` outside `leaving` is stale and
 *         changes nothing, so it can never take the column from a card that is showing.
 * Never:  read the DOM or a clock; throw.
 */

export type DockLayout = "center" | "dock" | "leaving";

export type DockLayoutEvent =
  /** The cards as rendered now: `present` is true when any card has something to show. */
  | { readonly type: "cards"; readonly present: boolean }
  /** The Card_Dock's onExitComplete: the dock has finished leaving. */
  | { readonly type: "exitComplete" };

/** The layout before any event. */
export function dockLayoutInit(present: boolean): DockLayout {
  return present ? "dock" : "center";
}

export function dockLayoutStep(layout: DockLayout, event: DockLayoutEvent): DockLayout {
  switch (event.type) {
    case "cards":
      if (event.present) return "dock";
      return layout === "center" ? "center" : "leaving";
    case "exitComplete":
      return layout === "leaving" ? "center" : layout;
    default:
      event satisfies never;
      return layout;
  }
}

/** Whether the grid shows the dock column: while a card shows and while the last one leaves. */
export function hasDockColumn(layout: DockLayout): boolean {
  return layout !== "center";
}
