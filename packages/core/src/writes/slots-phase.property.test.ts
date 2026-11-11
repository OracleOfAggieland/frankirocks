// Feature: voice-writes (brief 012), Property 12: Every FastSlots wait ends (design section 7 and 6.1). For any event
// sequence, `nextSlots` is total, starts the call at most once and never before the context is read (the `ready`
// event), a started call is `running` with its deadline FAST_SLOTS_DEADLINE_MS after the event that started it, and
// from `running` a deadline event at or after `deadlineAt` always settles it with a timeout. `settled` and
// `notNeeded` never change.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FAST_SLOTS_DEADLINE_MS, initialSlots, nextSlots } from "./slots-phase";
import type { FastSlotsResult, SlotsEvent, SlotsPhase } from "./types";

const resultArb: fc.Arbitrary<FastSlotsResult> = fc.oneof(
  fc.constant<FastSlotsResult>({ kind: "valid", out: { items: [], need: "none" }, ms: 120 }),
  fc.constant<FastSlotsResult>({ kind: "invalid", reason: "shape", path: "$.items", ms: 80 }),
  fc.constant<FastSlotsResult>({ kind: "timeout", ms: FAST_SLOTS_DEADLINE_MS }),
  fc.constant<FastSlotsResult>({ kind: "transport", ms: 10 }),
);

const atArb = fc.integer({ min: 0, max: 5_000 });

const eventArb: fc.Arbitrary<SlotsEvent> = fc.oneof(
  fc.record({ kind: fc.constant("ready" as const), asked: fc.boolean(), at: atArb }),
  fc.record({ kind: fc.constant("parsed" as const), route: fc.boolean(), at: atArb }),
  fc.record({ kind: fc.constant("answered" as const), result: resultArb }),
  fc.record({ kind: fc.constant("deadline" as const), at: atArb }),
);

describe("Property 12: every FastSlots wait ends", () => {
  it("nextSlots is total, starts at most once, never before the context is read, and a due deadline settles it", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(eventArb, { maxLength: 12 }), (regex, events) => {
        let phase: SlotsPhase = initialSlots(regex);
        expect(phase.kind).toBe("idle");
        let starts = 0;
        let ctxRead = false;
        for (const e of events) {
          const before = phase;
          if (e.kind === "ready") ctxRead = true;
          const r = nextSlots(before, e);
          phase = r.phase;
          if (r.start) {
            starts++;
            expect(ctxRead, "started before the context was read").toBe(true);
            expect(before.kind, "a start leaves idle").toBe("idle");
            expect(phase.kind).toBe("running");
            if (phase.kind === "running" && (e.kind === "ready" || e.kind === "parsed")) expect(phase.deadlineAt).toBe(e.at + FAST_SLOTS_DEADLINE_MS);
          } else if (before.kind === "idle") {
            expect(phase.kind, "idle never reaches running without a start").not.toBe("running");
          }
          if (before.kind === "settled" || before.kind === "notNeeded") expect(phase).toEqual(before);
          if (before.kind === "running" && e.kind === "deadline" && e.at >= before.deadlineAt) {
            expect(phase).toEqual({ kind: "settled", result: { kind: "timeout", ms: FAST_SLOTS_DEADLINE_MS } });
          }
          if (before.kind === "running" && e.kind === "answered") expect(phase).toEqual({ kind: "settled", result: e.result });
          if (before.kind === "running" && (e.kind === "ready" || e.kind === "parsed")) expect(phase).toEqual(before);
          if (before.kind === "running" && e.kind === "deadline" && e.at < before.deadlineAt) expect(phase).toEqual(before);
        }
        expect(starts).toBeLessThanOrEqual(1);
      }),
      { numRuns: 1_000 },
    );
  });

  it("with the context read, a regex, an asked question or a route parse always starts the call", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), atArb, (regex, asked, route, at) => {
        let phase = initialSlots(regex);
        let started = false;
        for (const e of [{ kind: "ready", asked, at }, { kind: "parsed", route, at: at + 1 }] as SlotsEvent[]) {
          const r = nextSlots(phase, e);
          started ||= r.start;
          phase = r.phase;
        }
        if (regex || asked || route) expect(started).toBe(true);
        else expect(phase.kind).toBe("notNeeded");
      }),
      { numRuns: 300 },
    );
  });
});
