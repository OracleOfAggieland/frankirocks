// The FastSlots call per request: one case per row of the table in design 6.1.
import { describe, expect, it } from "vitest";
import { FAST_SLOTS_DEADLINE_MS, initialSlots, nextSlots } from "./slots-phase";
import type { SlotsPhase } from "./types";

const valid = { kind: "valid" as const, out: { items: [], need: "none" as const }, ms: 200 };

describe("nextSlots", () => {
  it("idle: a regex starts on ready, with the deadline from that event", () => {
    expect(nextSlots(initialSlots(true), { kind: "ready", asked: false, at: 100 })).toEqual({ phase: { kind: "running", trigger: "regex", deadlineAt: 100 + FAST_SLOTS_DEADLINE_MS }, start: true });
  });
  it("idle: an asked question starts on ready; a route candidate starts on the parse", () => {
    expect(nextSlots(initialSlots(false), { kind: "ready", asked: true, at: 0 }).phase).toMatchObject({ kind: "running", trigger: "asked" });
    const read = nextSlots(initialSlots(false), { kind: "ready", asked: false, at: 0 }).phase;
    expect(read).toMatchObject({ kind: "idle", ctx: true });
    expect(nextSlots(read, { kind: "parsed", route: true, at: 50 })).toEqual({ phase: { kind: "running", trigger: "candidate", deadlineAt: 50 + FAST_SLOTS_DEADLINE_MS }, start: true });
  });
  it("idle: never before the context is read", () => {
    const parsed = nextSlots(initialSlots(true), { kind: "parsed", route: true, at: 0 });
    expect(parsed).toEqual({ phase: { kind: "idle", regex: true, ctx: false, asked: false, parse: "route" }, start: false });
    expect(nextSlots(parsed.phase, { kind: "ready", asked: false, at: 10 }).start).toBe(true);
  });
  it("idle: context read, nothing found, no regex, nothing asked is notNeeded", () => {
    const read = nextSlots(initialSlots(false), { kind: "ready", asked: false, at: 0 }).phase;
    expect(nextSlots(read, { kind: "parsed", route: false, at: 5 })).toEqual({ phase: { kind: "notNeeded" }, start: false });
  });
  it("running: no restart; settles on the answer or a due deadline, not an early one", () => {
    const running: SlotsPhase = { kind: "running", trigger: "regex", deadlineAt: 1000 };
    expect(nextSlots(running, { kind: "parsed", route: true, at: 10 })).toEqual({ phase: running, start: false });
    expect(nextSlots(running, { kind: "answered", result: valid }).phase).toEqual({ kind: "settled", result: valid });
    expect(nextSlots(running, { kind: "deadline", at: 999 }).phase).toBe(running);
    expect(nextSlots(running, { kind: "deadline", at: 1000 }).phase).toEqual({ kind: "settled", result: { kind: "timeout", ms: FAST_SLOTS_DEADLINE_MS } });
  });
  it("settled and notNeeded never change", () => {
    const settled: SlotsPhase = { kind: "settled", result: valid };
    expect(nextSlots(settled, { kind: "answered", result: { kind: "transport", ms: 1 } }).phase).toBe(settled);
    expect(nextSlots({ kind: "notNeeded" }, { kind: "ready", asked: true, at: 0 })).toEqual({ phase: { kind: "notNeeded" }, start: false });
  });
});
