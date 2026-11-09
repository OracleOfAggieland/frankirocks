import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type MediaQueryLike, ReducedMotionOverride, ReducedMotionWatcher, useReducedMotion } from "./reduced-motion";

function fakeQuery(initial: boolean) {
  const listeners = new Set<() => void>();
  const q: MediaQueryLike & { set(v: boolean): void; count(): number } = {
    matches: initial,
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
    set(v) {
      (q as { matches: boolean }).matches = v;
      listeners.forEach((l) => l());
    },
    count: () => listeners.size,
  };
  return q;
}

function Probe({ watcher }: { watcher?: ReducedMotionWatcher }) {
  return createElement("span", null, String(useReducedMotion(watcher)));
}

describe("ReducedMotionWatcher", () => {
  it("applies a change event synchronously", () => {
    const q = fakeQuery(false);
    const w = new ReducedMotionWatcher(q);
    const seen: boolean[] = [];
    const off = w.subscribe(() => seen.push(w.getSnapshot()));
    expect(w.getSnapshot()).toBe(false);
    q.set(true);
    expect(seen).toEqual([true]);
    expect(w.getSnapshot()).toBe(true);
    off();
    expect(q.count()).toBe(0);
  });

  it("stays on when matchMedia is missing", () => {
    expect(new ReducedMotionWatcher(null).getSnapshot()).toBe(true);
  });
});

describe("useReducedMotion", () => {
  it("renders calm on the server", () => {
    expect(renderToStaticMarkup(createElement(Probe, { watcher: new ReducedMotionWatcher(fakeQuery(false)) }))).toBe("<span>true</span>");
  });

  it("lets the override win", () => {
    const off = createElement(ReducedMotionOverride, { reduced: false }, createElement(Probe));
    const on = createElement(ReducedMotionOverride, { reduced: true }, createElement(Probe));
    expect(renderToStaticMarkup(off)).toBe("<span>false</span>");
    expect(renderToStaticMarkup(on)).toBe("<span>true</span>");
  });
});
