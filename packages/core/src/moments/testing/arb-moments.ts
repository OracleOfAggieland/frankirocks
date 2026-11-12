/**
 * Generators for the one-shot time properties (brief 023). Occasions are event Memories with a time row built the way
 * the resolver builds one, in zones with and without DST, and moves are successor Memories that replace them.
 */
import fc from "fast-check";
import { localMinuteAt } from "../../dates";
import { canonicalJSON, type Hasher } from "../../ids";
import { tsFromMs, type Time } from "../../schema/primitives";
import type { Memory } from "../../schema/records";
import { sampleMemory, testId } from "../../testing/samples";
import type { TickRow } from "../tick";
import type { MomentPlan } from "../types";

function fnv(bytes: Uint8Array, seed: number): string {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** A deterministic Hasher for tests (the construction the other lanes' tests use). */
export const momentHasher: Hasher = {
  sha256: (bytes) => [1, 2, 3, 4, 5, 6, 7, 8].map((s) => fnv(bytes, s)).join(""),
  id: (parts) => {
    const bytes = new TextEncoder().encode(canonicalJSON(parts));
    return `t${[1, 2, 3, 4, 5, 6].map((s) => fnv(bytes, s)).join("").slice(0, 42)}`;
  },
};

export const ZONES = ["UTC", "America/Chicago", "America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe", "Pacific/Chatham"] as const;

/** 2026-01-01T00:00Z to 2027-12-31: crosses every DST change of the zones above. */
export const START_MIN = Date.UTC(2026, 0, 1);
export const START_MAX = Date.UTC(2027, 11, 31);

const pad = (n: number) => String(n).padStart(2, "0");
function civilOf(ms: number, zone: string, withTime: boolean): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${pad(Number(p.month))}-${pad(Number(p.day))}`;
  return withTime ? `${date}T${pad(Number(p.hour) % 24)}:${pad(Number(p.minute))}` : date;
}

/** Local midnight of the day `ms` falls on in `zone` (first instant of that civil day). */
function midnightOf(ms: number, zone: string): number {
  return localMinuteAt(civilOf(ms, zone, false), 0, zone) ?? ms;
}

export type Precision = "instant" | "day" | "month" | "range" | "none";

export interface OccasionSpec {
  zone: (typeof ZONES)[number];
  startMs: number;
  precision: Precision;
  /** Minutes after start for an instant occasion's end; null for none. */
  endMinutes: number | null;
  /** Extra days for a day-only occasion's last day; 0 for one day. */
  extraDays: number;
}

export const occasionSpecArb: fc.Arbitrary<OccasionSpec> = fc.record({
  zone: fc.constantFrom(...ZONES),
  // Minute-aligned starts.
  startMs: fc.integer({ min: START_MIN / 60_000, max: START_MAX / 60_000 }).map((m) => m * 60_000),
  precision: fc.constantFrom<Precision>("instant", "instant", "day", "month", "range", "none"),
  endMinutes: fc.option(fc.integer({ min: 0, max: 8 * 60 }), { nil: null }),
  extraDays: fc.integer({ min: 0, max: 2 }),
});

export function timeOf(s: OccasionSpec): Time | null {
  if (s.precision === "none") return null;
  if (s.precision === "instant") {
    return {
      start: tsFromMs(s.startMs),
      end: s.endMinutes === null ? null : tsFromMs(s.startMs + s.endMinutes * 60_000),
      zone: s.zone,
      civilStart: civilOf(s.startMs, s.zone, true),
      civilEnd: s.endMinutes === null ? null : civilOf(s.startMs + s.endMinutes * 60_000, s.zone, true),
      precision: "instant",
      rrule: null,
      dtstart: null,
      originalCivilStart: null,
      recurrence: null,
    };
  }
  const day0 = midnightOf(s.startMs, s.zone);
  const last = s.extraDays === 0 ? null : civilOf(day0 + s.extraDays * 86_400_000 + 12 * 3_600_000, s.zone, false);
  return {
    start: tsFromMs(day0),
    end: null,
    zone: s.zone,
    civilStart: s.precision === "month" ? civilOf(day0, s.zone, false).slice(0, 7) + "-01" : civilOf(day0, s.zone, false),
    civilEnd: s.precision === "day" ? last : s.precision === "range" ? civilOf(day0 + 3 * 86_400_000, s.zone, false) : null,
    precision: s.precision,
    rrule: null,
    dtstart: null,
    originalCivilStart: null,
    recurrence: null,
  };
}

/** An event Memory for an occasion. */
export function occasionMemory(id: string, s: OccasionSpec, overrides: Partial<Memory> = {}): Memory {
  return sampleMemory({
    logicalId: id,
    kind: "event",
    predicate: "event",
    value: { kind: "text", text: "Tessellate Labs final interview" },
    args: { occasion: "interview", anchorRef: null, important: true },
    when: { kind: "spoken", spoken: "tomorrow at 2" },
    time: timeOf(s),
    ...overrides,
  });
}

/** A move: a successor that replaces `old` with a new time, as a transition writes it. */
export function moved(old: Memory, id: string, s: OccasionSpec): Memory {
  return occasionMemory(id, s, { replacesIds: [old.logicalId], scheduleRev: old.scheduleRev });
}

export const memId = (n: number) => testId(`occasion-${n}`);

/** Tick rows for plans, as the server stores them (pending, no lease). */
export function rowsOf(plans: readonly MomentPlan[]): TickRow[] {
  return plans.map((p) => ({ id: p.momentId, kind: p.kind, status: "pending" as const, dueAt: p.dueAt, closeAt: p.closeAt, leaseUntil: null }));
}
