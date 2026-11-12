import { describe, expect, it } from "vitest";
import type { Point } from "./geometry";
import { type PointerLike, type WindowLike, watchPointer } from "./watch";

class FakeWindow implements WindowLike {
  innerWidth = 1440;
  innerHeight = 900;
  readonly listeners = new Map<string, Set<(e: PointerLike) => void>>();
  addEventListener(type: string, listener: (e: PointerLike) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (e: PointerLike) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string, e: Partial<PointerLike>) {
    const full: PointerLike = { pointerType: "mouse", clientX: 0, clientY: 0, relatedTarget: null, ...e };
    this.listeners.get(type)?.forEach((l) => l(full));
  }
  count() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}

function setup() {
  const win = new FakeWindow();
  const seen: Point[] = [];
  const stop = watchPointer(win, (u) => seen.push(u));
  return { win, seen, stop };
}

describe("watchPointer", () => {
  it("follows a mouse and a pen, against the pointer", () => {
    const { win, seen } = setup();
    win.fire("pointermove", { pointerType: "mouse", clientX: 1440, clientY: 0 });
    win.fire("pointermove", { pointerType: "pen", clientX: 0, clientY: 900 });
    expect(seen).toHaveLength(2);
    expect(seen[0].x).toBeCloseTo(-1);
    expect(seen[0].y).toBeCloseTo(1);
    expect(seen[1].x).toBeCloseTo(1);
    expect(seen[1].y).toBeCloseTo(-1);
  });

  it("ignores touch", () => {
    const { win, seen } = setup();
    win.fire("pointermove", { pointerType: "touch", clientX: 10, clientY: 10 });
    expect(seen).toHaveLength(0);
  });

  it("settles to centre when the pointer leaves the window, not when it moves between elements", () => {
    const { win, seen } = setup();
    win.fire("pointerout", { relatedTarget: {} });
    expect(seen).toHaveLength(0);
    win.fire("pointerout", { relatedTarget: null });
    expect(seen).toEqual([{ x: 0, y: 0 }]);
  });

  it("listens to both events and removes both on cleanup", () => {
    const { win, seen, stop } = setup();
    expect(win.listeners.get("pointermove")?.size).toBe(1);
    expect(win.listeners.get("pointerout")?.size).toBe(1);
    stop();
    expect(win.count()).toBe(0);
    win.fire("pointermove", { clientX: 5, clientY: 5 });
    expect(seen).toHaveLength(0);
  });
});
