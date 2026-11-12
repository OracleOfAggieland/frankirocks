// Brief 039, property 2: a period's end is the period's last instant. For any world time and any zone, each listed
// phrase resolves to an instant inside its local week, month, year or day, and the next millisecond is outside it.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolvePeriod } from "./dates";

const ZONES = [
  "UTC",
  "America/Chicago",
  "America/New_York",
  "America/Los_Angeles",
  "America/St_Johns",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Tehran",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
  "Pacific/Apia",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WORDS = ["a", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

// Written here, from Intl alone, not from the resolver's helpers.
function local(ms: number, zone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric" });
  const p = f.formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: g("year"), m: g("month"), d: g("day") };
}
const dayNo = (c: { y: number; m: number; d: number }) => Date.UTC(c.y, c.m - 1, c.d) / 86_400_000;
/** Monday-start week number (brief 039 ruling: "this week" ends on Sunday). */
const weekNo = (c: { y: number; m: number; d: number }) => Math.floor((dayNo(c) - 4) / 7); // 1970-01-05 was a Monday
const monthNo = (c: { y: number; m: number }) => c.y * 12 + c.m - 1;

type Phrase =
  | { kind: "this"; unit: "week" | "month" | "year"; text: string }
  | { kind: "month"; month: number; text: string }
  | { kind: "count"; unit: "days" | "weeks"; n: number; text: string };

const phrase: fc.Arbitrary<Phrase> = fc.oneof(
  fc.tuple(fc.constantFrom("week", "month", "year" as const), fc.boolean()).map(([unit, lead]) => ({ kind: "this" as const, unit: unit as "week" | "month" | "year", text: `${lead ? "for " : ""}this ${unit}` })),
  fc.tuple(fc.integer({ min: 1, max: 12 }), fc.constantFrom("for", "in")).map(([month, pre]) => ({ kind: "month" as const, month, text: `${pre} ${MONTHS[month - 1]}` })),
  fc.tuple(fc.constantFrom("days" as const, "weeks" as const), fc.integer({ min: 1, max: 10 }), fc.boolean()).map(([unit, n, word]) => ({
    kind: "count" as const,
    unit,
    n,
    text: `for ${word ? WORDS[n] : String(n)} ${n === 1 ? unit.slice(0, -1) : unit}`,
  })),
);

describe("property 2: a period's end is the period's last instant", () => {
  it("each listed phrase ends inside its period, and the next millisecond is outside", () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2040, 0, 1) }), fc.constantFrom(...ZONES), phrase, (now, zone, p) => {
        const r = resolvePeriod(p.text, now, zone);
        expect(r, p.text).not.toBeNull();
        const end = local(r!.endMs, zone);
        const next = local(r!.endMs + 1, zone);
        const today = local(now, zone);
        expect(r!.endMs).toBeGreaterThanOrEqual(now);
        if (p.kind === "this") {
          const same = p.unit === "week" ? weekNo : p.unit === "month" ? monthNo : (c: { y: number }) => c.y;
          expect(same(end)).toBe(same(today));
          expect(same(next)).toBe(same(today) + 1);
        } else if (p.kind === "month") {
          // The named month: this one while it lasts, else its next coming.
          expect(end.m).toBe(p.month);
          expect(monthNo(next)).toBe(monthNo(end) + 1);
          const ahead = monthNo(end) - monthNo(today);
          expect(ahead >= 0 && ahead < 12).toBe(true);
        } else {
          // Today counts as the first day.
          const days = p.unit === "days" ? p.n : p.n * 7;
          expect(dayNo(end) - dayNo(today)).toBe(days - 1);
          expect(dayNo(next)).toBe(dayNo(end) + 1);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("'until' a day the resolver reads ends with that day", () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2040, 0, 1) }), fc.constantFrom(...ZONES), fc.constantFrom("until tomorrow", "until friday", "until monday", "until december 3"), (now, zone, text) => {
        const r = resolvePeriod(text, now, zone);
        // "until tomorrow" in the small hours names no one day, as the day resolver says; anything else resolves.
        if (r === null) return;
        const end = local(r.endMs, zone);
        expect(dayNo(local(r.endMs + 1, zone))).toBe(dayNo(end) + 1);
        expect(dayNo(end)).toBeGreaterThanOrEqual(dayNo(local(now, zone)));
      }),
      { numRuns: 1000 },
    );
  });

  it("a phrase outside the list gives no end", () => {
    for (const t of ["next spring", "for a while", "this weekend", "for now", "soon", "for good", "until I feel better"]) expect(resolvePeriod(t, Date.UTC(2026, 10, 5, 16), "America/Chicago")).toBeNull();
  });
});
