import { describe, expect, it, vi } from "vitest";
import { type GestureTarget, SharedAudio, sharedAudio } from "./context";

function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  const target: GestureTarget & { fire(type: string): void; count(): number } = {
    addEventListener: (type, l) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(l);
    },
    removeEventListener: (type, l) => listeners.get(type)?.delete(l),
    fire: (type) => [...(listeners.get(type) ?? [])].forEach((l) => l()),
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
  return target;
}

describe("SharedAudio", () => {
  it("creates no context before the first gesture", () => {
    const create = vi.fn(() => ({}) as AudioContext);
    const audio = new SharedAudio(fakeTarget(), create);
    expect(audio.getContext()).toBeNull();
    expect(audio.hasGesture()).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["pointerdown", "keydown"])("creates one context on the first %s and stops listening", (type) => {
    const target = fakeTarget();
    const ctx = {} as AudioContext;
    const create = vi.fn(() => ctx);
    const audio = new SharedAudio(target, create);
    target.fire(type);
    target.fire("pointerdown");
    expect(audio.getContext()).toBe(ctx);
    expect(audio.hasGesture()).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(target.count()).toBe(0);
  });

  it("stays null when Web Audio is missing or throws", () => {
    const t1 = fakeTarget();
    const missing = new SharedAudio(t1, null);
    t1.fire("keydown");
    expect(missing.getContext()).toBeNull();
    const t2 = fakeTarget();
    const throwing = new SharedAudio(t2, () => {
      throw new Error("no audio");
    });
    t2.fire("keydown");
    expect(throwing.getContext()).toBeNull();
    expect(throwing.hasGesture()).toBe(true);
  });

  it("is null on the server", () => {
    expect(sharedAudio()).toBeNull();
  });
});
