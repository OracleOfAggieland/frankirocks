import { describe, expect, it } from "vitest";
import { type DocumentLike, VisibilityGate } from "./page-visible";

function fakeDocument() {
  const listeners = new Set<() => void>();
  const doc: DocumentLike & { set(v: string): void; count(): number } = {
    visibilityState: "visible",
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
    set(v) {
      (doc as { visibilityState: string }).visibilityState = v;
      listeners.forEach((l) => l());
    },
    count: () => listeners.size,
  };
  return doc;
}

describe("VisibilityGate", () => {
  it("tells listeners on hidden and visible", () => {
    const doc = fakeDocument();
    const gate = new VisibilityGate(doc);
    const seen: boolean[] = [];
    const off = gate.subscribe((v) => seen.push(v));
    doc.set("hidden");
    expect(gate.isVisible()).toBe(false);
    doc.set("visible");
    expect(seen).toEqual([false, true]);
    off();
    expect(doc.count()).toBe(0);
  });

  it("counts as visible without a document", () => {
    expect(new VisibilityGate(null).isVisible()).toBe(true);
  });
});
