import { describe, expect, it } from "vitest";
import { localMinuteAt } from "../dates";
import { tsFromMs, validate } from "../index";
import { Moment } from "../schema/records";
import { sampleMemory, testId } from "../testing/samples";
import { DAY_MS, HOUR_MS } from "./constants";
import { deriveExpiry, deriveLoop, deriveOccasion, isResolved } from "./derive";
import { mergeMoment, momentRow, retireMoment } from "./merge";
import { memId, momentHasher, occasionMemory } from "./testing/arb-moments";

const ZONE = "America/Chicago";
const CTX = { uid: "owner-1", opsNow: Date.UTC(2026, 10, 12), epoch: 1, policyRev: 1, clockMode: "fixture" as const };
const at = (date: string, minute: number) => localMinuteAt(date, minute, ZONE)!;
const derive = (m: ReturnType<typeof occasionMemory>) => deriveOccasion(m, new Map([[m.logicalId, m]]), momentHasher);
const kinds = (r: ReturnType<typeof derive>) => Object.fromEntries(r.plans.map((p) => [p.kind, p]));

describe("derive: occasions", () => {
  it("the interview at 14:00: wish at 08:30, check-in at 18:00 (end 15:00 + 3 h)", () => {
    const start = at("2026-11-13", 14 * 60);
    const m = occasionMemory(memId(1), { zone: ZONE, startMs: start, precision: "instant", endMinutes: null, extraDays: 0 });
    const k = kinds(derive(m));
    expect(k.wish!.dueAt).toBe(at("2026-11-13", 8 * 60 + 30));
    expect(k.wish!.closeAt).toBe(start);
    expect(k.checkIn!.dueAt).toBe(start + HOUR_MS + 3 * HOUR_MS);
    expect(k.checkIn!.closeAt).toBe(start + HOUR_MS + 3 * DAY_MS);
    expect(k.wish!.payload).toMatchObject({ kind: "cue", template: { text: "Good luck at 2 PM: Tessellate Labs final interview." } });
  });

  it("a 10:30 start gets its wish at 08:00, a 07:00 start none", () => {
    const late = occasionMemory(memId(1), { zone: ZONE, startMs: at("2026-11-13", 10 * 60 + 30), precision: "instant", endMinutes: 30, extraDays: 0 });
    expect(kinds(derive(late)).wish!.dueAt).toBe(at("2026-11-13", 8 * 60));
    const early = occasionMemory(memId(2), { zone: ZONE, startMs: at("2026-11-13", 7 * 60), precision: "instant", endMinutes: 30, extraDays: 0 });
    const r = derive(early);
    expect(kinds(r).wish).toBeUndefined();
    expect(r.retired).toHaveLength(1);
  });

  it("a day-only date (\"Biscuit has surgery Thursday\"): no wish, check-in at 18:00", () => {
    const m = occasionMemory(memId(3), { zone: ZONE, startMs: at("2026-11-19", 9 * 60), precision: "day", endMinutes: null, extraDays: 0 }, { value: { kind: "text", text: "Biscuit's surgery" } });
    const r = derive(m);
    expect(kinds(r).wish).toBeUndefined();
    expect(kinds(r).checkIn!.dueAt).toBe(at("2026-11-19", 18 * 60));
    expect(kinds(r).checkIn!.closeAt).toBe(at("2026-11-23", 0));
  });

  it("unresolved, month and range times derive nothing", () => {
    for (const precision of ["none", "month", "range"] as const) {
      const m = occasionMemory(memId(4), { zone: ZONE, startMs: at("2026-11-19", 9 * 60), precision, endMinutes: null, extraDays: 0 });
      expect(isResolved(m.time)).toBe(false);
      expect(derive(m).plans).toEqual([]);
    }
  });

  it("a history or wrong occasion derives nothing", () => {
    const m = occasionMemory(memId(5), { zone: ZONE, startMs: at("2026-11-13", 14 * 60), precision: "instant", endMinutes: null, extraDays: 0 }, { status: "history" });
    expect(derive(m).plans).toEqual([]);
  });

  it("rows validate against the Moment schema, and merge rewrites only pending rows", () => {
    const m = occasionMemory(memId(1), { zone: ZONE, startMs: at("2026-11-13", 14 * 60), precision: "instant", endMinutes: null, extraDays: 0 });
    const [wish] = derive(m).plans;
    const row = momentRow(wish!, CTX, momentHasher);
    expect(validate(Moment, row).ok).toBe(true);
    expect(mergeMoment(row, wish!, CTX, momentHasher)).toBeNull();
    const later = { ...wish!, dueAt: wish!.dueAt + HOUR_MS };
    expect(mergeMoment(row, later, CTX, momentHasher)?.dueAt).toBe(tsFromMs(later.dueAt));
    expect(mergeMoment({ ...row, status: "expired" }, later, CTX, momentHasher)).toBeNull();
    expect(retireMoment(row, CTX)?.status).toBe("skipped");
    expect(retireMoment({ ...row, status: "delivered" }, CTX)).toBeNull();
  });
});

describe("derive: loops and bounded facts", () => {
  it("a waiting loop gets a celebrate at checkAt; a celebrated one none", () => {
    const checkAt = Date.UTC(2026, 11, 5, 6);
    const loop = {
      acceptedActionId: testId("action"),
      metric: "takeoutSpend" as const,
      baseline: { fromCivil: "2026-10-23", toCivil: "2026-11-12", zone: ZONE, currency: "USD", coverage: { state: "complete" as const, from: null, to: null, missingRanges: [], generation: 0 }, purchaseIds: [], valueCents: 18600, weekdayCounts: [3, 3, 3, 3, 3, 3, 3] },
      comparison: { fromCivil: "2026-11-14", toCivil: "2026-12-04", zone: ZONE, currency: "USD", coverage: { state: "complete" as const, from: null, to: null, missingRanges: [], generation: 0 }, purchaseIds: [], valueCents: null, weekdayCounts: [3, 3, 3, 3, 3, 3, 3] },
      checkAt: tsFromMs(checkAt),
      predicateVersion: "takeout_late_meeting_v1" as const,
      state: "waiting" as const,
      appraisalRef: null,
    };
    const m = sampleMemory({ logicalId: testId("loop"), kind: "loop", loop });
    const [p] = deriveLoop(m, momentHasher).plans;
    expect(p).toMatchObject({ kind: "celebrate", dueAt: checkAt, closeAt: checkAt + 7 * DAY_MS });
    expect(validate(Moment, momentRow(p!, CTX, momentHasher)).ok).toBe(true);
    expect(deriveLoop({ ...m, loop: { ...loop, state: "celebrated" } }, momentHasher).plans).toEqual([]);
  });

  it("a bounded fact asks at validTo; a rule never does", () => {
    const validTo = tsFromMs(Date.UTC(2026, 11, 1));
    expect(deriveExpiry(sampleMemory({ validTo }), ZONE, momentHasher).plans[0]).toMatchObject({ kind: "expiryAsk", dueAt: Date.UTC(2026, 11, 1) });
    expect(deriveExpiry(sampleMemory({ validTo, kind: "rule" }), ZONE, momentHasher).plans).toEqual([]);
    expect(deriveExpiry(sampleMemory({ validTo, predicate: "allergy" }), ZONE, momentHasher).plans).toEqual([]);
  });
});
