// Feature: one-shot time (brief 023), property "Caps and quiet hours hold" (spec §5 Delivery: "Quiet hours
// 21:30-08:00. Three proactive a day, one heavy"; spec §6 "mustSay bypasses the cap"). For any world day of due
// moments, delivered through any sequence of idle moments and session openings, delivery never speaks more than three
// proactive lines, never more than one heavy one, and never one inside quiet hours, counting only moments that are
// not mustSay and carry no override for that limit. A card is never speech.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { localMinuteAt, localMinuteOf } from "../dates";
import { testId } from "../testing/samples";
import { chooseDelivery, type DeliveryCandidate, type DeliveryMode } from "./delivery";
import { ZONES } from "./testing/arb-moments";

const KINDS = ["wish", "checkIn", "ask", "expiryAsk", "insight", "celebrate", "commitmentDue", "door"] as const;
const QUIET = (minute: number) => minute >= 21 * 60 + 30 || minute < 8 * 60;

const dayArb = fc.record({
  zone: fc.constantFrom(...ZONES),
  day: fc.integer({ min: 0, max: 700 }),
  moments: fc.array(
    fc.record({
      kind: fc.constantFrom(...KINDS),
      dueMinute: fc.integer({ min: 0, max: 1439 }),
      heavy: fc.boolean(),
      mustSay: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
      override: fc.option(fc.record({ quietHours: fc.boolean(), caps: fc.boolean() }), { nil: null }),
    }),
    { minLength: 1, maxLength: 12 },
  ),
  calls: fc.array(
    fc.record({
      minute: fc.integer({ min: 0, max: 1439 }),
      mode: fc.oneof(
        fc.constant<DeliveryMode>({ kind: "opening" }),
        fc.record({ kind: fc.constant("session" as const), listening: fc.boolean(), silentMs: fc.integer({ min: 0, max: 20_000 }) }),
      ),
      transitionOrCrisis: fc.boolean(),
      turnsSinceCheckInAnswer: fc.option(fc.nat(5), { nil: null }),
    }),
    { minLength: 1, maxLength: 20 },
  ),
});

describe("one-shot time: caps and quiet hours hold", () => {
  it("never more than three proactive, one heavy, or any in quiet hours, except mustSay", () => {
    fc.assert(
      fc.property(dayArb, (c) => {
        const date = new Date(Date.UTC(2026, 0, 1) + c.day * 86_400_000).toISOString().slice(0, 10);
        const at = (minute: number) => localMinuteAt(date, minute, c.zone)!;
        const all: DeliveryCandidate[] = c.moments.map((m, i) => ({ momentId: testId(`m-${i}`), kind: m.kind, dueAt: at(m.dueMinute), heavy: m.heavy, mustSay: m.mustSay, override: m.override }));
        const left = new Map(all.map((m) => [m.momentId, m]));
        const today = { proactive: 0, heavy: 0 };
        let capped = 0;
        let heavyCapped = 0;
        for (const call of [...c.calls].sort((a, b) => a.minute - b.minute)) {
          const now = at(call.minute);
          const due = [...left.values()].filter((m) => m.dueAt <= now);
          const out = chooseDelivery({ candidates: due, mode: call.mode, transitionOrCrisis: call.transitionOrCrisis, turnsSinceCheckInAnswer: call.turnsSinceCheckInAnswer, today: { ...today }, worldNow: now, zone: c.zone });
          for (const id of out.cards) expect(out.spoken?.momentId).not.toBe(id);
          if (out.spoken === null) continue;
          const m = left.get(out.spoken.momentId)!;
          left.delete(m.momentId);
          today.proactive++;
          if (m.heavy) today.heavy++;
          if (m.mustSay) continue;
          if (!(m.override?.quietHours ?? false)) expect(QUIET(localMinuteOf(now, c.zone))).toBe(false);
          if (!(m.override?.caps ?? false)) {
            capped++;
            if (m.heavy) heavyCapped++;
            expect(capped).toBeLessThanOrEqual(3);
            expect(heavyCapped).toBeLessThanOrEqual(1);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
