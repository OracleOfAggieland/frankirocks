// Feature: one-shot time (brief 023), property "A jump equals waiting" (spec §5 "A clock jump runs the same code for
// one user"). For any set of occasions and any jump forward of up to ten hours, jumping straight to T opens the same
// moments, in the same order, and leaves every moment in the same state, as ticking once a minute up to T. Some
// celebrate-like moments miss their predicate. The state is built once per case and only the clock varies, so the
// body stays cheap at 1,000 runs.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deriveOccasion } from "./derive";
import { memId, momentHasher, occasionMemory, type Precision, rowsOf, ZONES } from "./testing/arb-moments";
import { applyTransitions, planTick, type TickRow } from "./tick";

const MINUTE = 60_000;
const T_MIN = Date.UTC(2026, 0, 1) / MINUTE;
const T_MAX = Date.UTC(2027, 11, 1) / MINUTE;

const caseArb = fc.record({
  t0: fc.integer({ min: T_MIN, max: T_MAX }).map((m) => m * MINUTE),
  occasions: fc.array(
    fc.record({
      zone: fc.constantFrom(...ZONES),
      offsetMinutes: fc.integer({ min: -6 * 60, max: 10 * 60 }),
      precision: fc.constantFrom<Precision>("instant", "instant", "day"),
      endMinutes: fc.option(fc.integer({ min: 0, max: 4 * 60 }), { nil: null }),
    }),
    { minLength: 1, maxLength: 5 },
  ),
  /** Seconds past the minute for one moment's due time, so not every due time is on a tick. */
  jitterSeconds: fc.integer({ min: 0, max: 59 }),
  spanMinutes: fc.integer({ min: 0, max: 10 * 60 }),
  missIndex: fc.nat(10),
  /** A celebrate stands in for one row, so a predicate miss is in the mix. */
  celebrateIndex: fc.nat(10),
});

describe("one-shot time: a jump equals waiting", () => {
  it("opens the same moments in the same order", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const plans = c.occasions.flatMap((o, i) => {
          const m = occasionMemory(memId(i), { zone: o.zone, startMs: c.t0 + o.offsetMinutes * MINUTE, precision: o.precision, endMinutes: o.endMinutes, extraDays: 0 });
          return deriveOccasion(m, new Map([[m.logicalId, m]]), momentHasher).plans;
        });
        const rows: TickRow[] = rowsOf(plans).map((r, i) => ({
          ...r,
          dueAt: i === 0 ? r.dueAt + c.jitterSeconds * 1000 : r.dueAt,
          kind: i === c.celebrateIndex ? "celebrate" : r.kind,
        }));
        const target = c.t0 + c.spanMinutes * MINUTE;
        const ops = c.t0;
        const miss = new Set(rows.filter((_, i) => i === c.missIndex).map((r) => r.id));
        const input = (rs: readonly TickRow[], worldNow: number) => ({ rows: rs, worldNow, opsNow: ops, source: () => "ok" as const, passes: (id: string) => !miss.has(id) });

        // Settle the start: whatever is already due at t0 is handled before either path begins.
        const start = applyTransitions(rows, planTick(input(rows, c.t0)), ops);

        const jumped = planTick(input(start, target));
        const jumpOpens = jumped.filter((t) => t.to === "leased").map((t) => t.momentId);
        const jumpEnd = applyTransitions(start, jumped, ops);

        let state = start;
        const waitOpens: string[] = [];
        for (let t = c.t0 + MINUTE; t <= target; t += MINUTE) {
          const ts = planTick(input(state, t));
          waitOpens.push(...ts.filter((x) => x.to === "leased").map((x) => x.momentId));
          state = applyTransitions(state, ts, ops);
        }
        expect(waitOpens).toEqual(jumpOpens);
        const statuses = (rs: readonly TickRow[]) => Object.fromEntries(rs.map((r) => [r.id, r.status]));
        expect(statuses(state)).toEqual(statuses(jumpEnd));
      }),
      { numRuns: 1000 },
    );
  });
});
