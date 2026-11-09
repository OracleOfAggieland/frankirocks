import { describe, expect, it } from "vitest";
import { looksLikeTime, resolveSpoken, spokenOnLabel, timeRow } from "./dates";
import { Time } from "./schema/primitives";
import { validate } from "./schema/v";

const ZONE = "America/Chicago";
/** Wednesday, Nov 4 2026, 10:00 in Chicago (CST, UTC-6). */
const WED_10AM = Date.parse("2026-11-04T16:00:00.000Z");
const at = (spoken: string, ms = WED_10AM) => resolveSpoken(spoken, ms, ZONE);
/** "2026-03-08T03:30": what a zone's clock reads at an instant. */
const wallIn = (ms: number, zone: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

describe("resolveSpoken (memory-spec §5: code computes dates from the words said)", () => {
  it("a weekday with a clock time: the next one, afternoon by default", () => {
    expect(at("Friday at 3")).toEqual({
      civilStart: "2026-11-06T15:00",
      precision: "instant",
      startMs: Date.parse("2026-11-06T21:00:00.000Z"),
      zone: ZONE,
      label: "Friday, Nov 6 at 3 PM",
    });
  });

  it("relative days, with day precision when no time is said", () => {
    expect(at("tomorrow")).toMatchObject({ civilStart: "2026-11-05", precision: "day", startMs: Date.parse("2026-11-05T06:00:00.000Z"), label: "Thursday, Nov 5" });
    expect(at("tomorrow morning at 9:30")).toMatchObject({ civilStart: "2026-11-05T09:30", label: "Thursday, Nov 5 at 9:30 AM" });
    expect(at("tonight at 7")).toMatchObject({ civilStart: "2026-11-04T19:00", label: "Wednesday, Nov 4 at 7 PM" });
    expect(at("today at noon")).toMatchObject({ civilStart: "2026-11-04T12:00", label: "Wednesday, Nov 4 at noon" });
    expect(at("in two weeks")).toMatchObject({ civilStart: "2026-11-18", precision: "day" });
    expect(at("day after tomorrow at 8 am")).toMatchObject({ civilStart: "2026-11-06T08:00" });
  });

  it("a weekday said on that same weekday is unsure unless 'this' or 'today' says which", () => {
    expect(at("on Wednesday")).toBeNull();
    expect(at("Wednesday at 3")).toBeNull();
    expect(at("this Wednesday at 5pm")).toMatchObject({ civilStart: "2026-11-04T17:00" });
    expect(at("today, Wednesday, at 5")).toMatchObject({ civilStart: "2026-11-04T17:00" });
    expect(at("on Thursday")).toMatchObject({ civilStart: "2026-11-05" });
    expect(at("Saturday night at 8")).toMatchObject({ civilStart: "2026-11-07T20:00", label: "Saturday, Nov 7 at 8 PM" });
  });

  it("month and day: the next one on or after today, with the year shown when it is not this year", () => {
    expect(at("March 14th")).toMatchObject({ civilStart: "2027-03-14", label: "Sunday, Mar 14, 2027" });
    expect(at("the 14th of March")).toMatchObject({ civilStart: "2027-03-14" });
    expect(at("December 3")).toMatchObject({ civilStart: "2026-12-03", label: "Thursday, Dec 3" });
    expect(at("11/20 at 10:15")).toMatchObject({ civilStart: "2026-11-20T10:15" });
    expect(at("Nov 4")).toMatchObject({ civilStart: "2026-11-04" });
  });

  it("a weekday said with a date names that date when they agree, and nothing when they don't", () => {
    expect(at("Friday, November 13 at 3")).toMatchObject({ civilStart: "2026-11-13T15:00", label: "Friday, Nov 13 at 3 PM" });
    // Said on a Wednesday, a Wednesday's date is still that date.
    expect(at("Wednesday, November 11")).toMatchObject({ civilStart: "2026-11-11" });
    expect(at("Thursday, November 13")).toBeNull();
    expect(at("in 1/2 hour")).toBeNull();
    expect(at("1/2 an hour from now")).toBeNull();
  });

  it("crosses a DST change with the right offset", () => {
    expect(at("March 15, 2027 at 9 am")).toMatchObject({ civilStart: "2027-03-15T09:00", startMs: Date.parse("2027-03-15T14:00:00.000Z") });
  });

  it("before 4 AM, 'tomorrow' is the day that is starting (the social day)", () => {
    const thu130am = Date.parse("2026-11-05T07:30:00.000Z");
    expect(at("tomorrow at 10", thu130am)).toMatchObject({ civilStart: "2026-11-05T10:00" });
  });

  it("returns null for words that do not name exactly one day", () => {
    for (const words of ["next Friday", "next week", "next spring", "Friday or Saturday", "this weekend", "sometime soon", "last Tuesday", "February 30", "13/40", "", "at 3", "on Fridays"]) {
      expect(at(words), words).toBeNull();
    }
    expect(at("Friday at 3 and at 4")).toBeNull();
  });

  it("a month and day without a year that just went by is unsure, not a year out", () => {
    const fri10am = Date.parse("2026-11-06T16:00:00.000Z");
    expect(at("November 2", fri10am)).toBeNull();
    expect(at("11/2", fri10am)).toBeNull();
    expect(at("December 25", fri10am)).toMatchObject({ civilStart: "2026-12-25", label: "Friday, Dec 25" });
    expect(at("12/25", fri10am)).toMatchObject({ civilStart: "2026-12-25" });
    expect(at("January 5", fri10am)).toMatchObject({ civilStart: "2027-01-05", label: "Tuesday, Jan 5, 2027" });
    // 270 days ahead is the furthest a date without a year reaches; a year said keeps its year.
    expect(at("August 3", fri10am)).toMatchObject({ civilStart: "2027-08-03" });
    expect(at("August 4", fri10am)).toBeNull();
    expect(at("November 2, 2027", fri10am)).toMatchObject({ civilStart: "2027-11-02" });
  });

  it("before 4 AM, 'today', 'tonight' and 'this morning' are unsure: the day ending or the day starting", () => {
    const sat130am = Date.parse("2026-11-07T07:30:00.000Z");
    for (const words of ["tonight at 8", "today at 3", "this morning", "this afternoon at 2", "this evening"]) expect(at(words, sat130am), words).toBeNull();
    // "Tomorrow" and weekdays keep the social day.
    expect(at("tomorrow at 10", sat130am)).toMatchObject({ civilStart: "2026-11-07T10:00" });
    expect(at("on Saturday at 10", sat130am)).toMatchObject({ civilStart: "2026-11-07T10:00" });
  });

  it("midnight, a bare 12 at night, or an AM time at night is unsure, since midnight starts the next day", () => {
    for (const words of ["tonight at 12", "tonight at 12:30", "Friday night at 12", "tonight at midnight", "Friday at midnight", "tonight at 1 am", "Saturday night at 12 am"]) {
      expect(at(words), words).toBeNull();
    }
    // Said at 6 PM, "today at 12" could be noon gone by or midnight to come.
    expect(at("today at 12", Date.parse("2026-11-05T00:00:00.000Z"))).toBeNull();
    expect(at("Friday at 12")).toMatchObject({ civilStart: "2026-11-06T12:00", label: "Friday, Nov 6 at noon" });
  });

  it("after 5 PM the evening default does not reach words that name the morning, afternoon or lunch", () => {
    const wed530pm = Date.parse("2026-11-04T23:30:00.000Z");
    expect(at("this morning at 9", wed530pm)).toMatchObject({ civilStart: "2026-11-04T09:00", label: "Wednesday, Nov 4 at 9 AM" });
    expect(at("lunch today at 11", wed530pm)).toMatchObject({ civilStart: "2026-11-04T11:00" });
    expect(at("today at 9", wed530pm)).toMatchObject({ civilStart: "2026-11-04T21:00" });
    // Morning and evening words together do not say which 9.
    expect(at("this morning at 9, then dinner")).toBeNull();
  });

  it("a weekday counted from another day, pinned to a date or named for a holiday is not the coming one", () => {
    for (const words of [
      "the Friday after next",
      "Friday after next",
      "a week from Friday",
      "a week on Friday",
      "Friday week",
      "a week Friday",
      "two weeks from Friday",
      "a week from today",
      "a week from tomorrow",
      "three days after tomorrow",
      "the day before Friday",
      "the Friday before Christmas",
      "Friday after Thanksgiving",
      "Friday the 13th",
      "Friday the 13",
      "Friday, the thirteenth",
      "Friday 13th",
      "Black Friday",
    ]) {
      expect(at(words), words).toBeNull();
    }
    expect(at("the day after tomorrow")).toMatchObject({ civilStart: "2026-11-06" });
    expect(at("Friday after work at 6")).toMatchObject({ civilStart: "2026-11-06T18:00" });
  });

  it("slash dates resolve only in American zones, which put the month first", () => {
    expect(resolveSpoken("3/4", WED_10AM, "Europe/London")).toBeNull();
    expect(resolveSpoken("3/4", WED_10AM, "UTC")).toBeNull();
    expect(resolveSpoken("3/4", WED_10AM, ZONE)).toMatchObject({ civilStart: "2027-03-04" });
    expect(resolveSpoken("March 4", WED_10AM, "Europe/London")).toMatchObject({ civilStart: "2027-03-04", startMs: Date.parse("2027-03-04T00:00:00.000Z") });
  });

  it("a clock time that DST skips or repeats is unsure, not an instant an hour off", () => {
    // Chicago springs forward at 2 AM on Sunday, Mar 8 2026: 2:00 to 2:59 never happens.
    const friMar6 = Date.parse("2026-03-06T16:00:00.000Z");
    expect(at("Sunday at 2:30 AM", friMar6)).toBeNull();
    expect(at("Sunday at 1:30 AM", friMar6)).toMatchObject({ civilStart: "2026-03-08T01:30", startMs: Date.parse("2026-03-08T07:30:00.000Z") });
    expect(at("Sunday at 3:30 AM", friMar6)).toMatchObject({ civilStart: "2026-03-08T03:30", startMs: Date.parse("2026-03-08T08:30:00.000Z") });
    // It falls back at 2 AM on Sunday, Nov 1 2026: 1:00 to 1:59 happens twice.
    const friOct30 = Date.parse("2026-10-30T15:00:00.000Z");
    expect(at("Sunday at 1:30 AM", friOct30)).toBeNull();
    expect(at("Sunday at 2:30 AM", friOct30)).toMatchObject({ civilStart: "2026-11-01T02:30", startMs: Date.parse("2026-11-01T08:30:00.000Z") });
    expect(at("Sunday", friOct30)).toMatchObject({ civilStart: "2026-11-01", startMs: Date.parse("2026-11-01T05:00:00.000Z") });
  });

  it("every half hour of both 2026 Chicago DST days reads back as its label, but for the skipped and repeated hours", () => {
    for (const [saidAt, unsureHour] of [
      ["2026-03-07T18:00:00.000Z", 2],
      ["2026-10-31T17:00:00.000Z", 1],
    ] as const) {
      for (let hh = 0; hh < 24; hh++) {
        for (const mm of ["00", "30"]) {
          const clock = `${hh % 12 === 0 ? 12 : hh % 12}:${mm} ${hh < 12 ? "am" : "pm"}`;
          const r = at(`tomorrow at ${clock}`, Date.parse(saidAt));
          if (hh === unsureHour) expect(r, clock).toBeNull();
          else expect(wallIn(r!.startMs, ZONE), clock).toBe(r!.civilStart);
        }
      }
    }
  });

  it("a day whose midnight DST skips starts at its first instant", () => {
    // The Azores jump from midnight to 1 AM on Sunday, Mar 29 2026.
    const r = resolveSpoken("Sunday", Date.parse("2026-03-27T13:00:00.000Z"), "Atlantic/Azores");
    expect(r).toMatchObject({ civilStart: "2026-03-29", startMs: Date.parse("2026-03-29T01:00:00.000Z") });
    expect(wallIn(r!.startMs, "Atlantic/Azores")).toBe("2026-03-29T01:00");
  });

  it("builds a Time row that passes the schema", () => {
    const r = at("Friday at 3")!;
    const row = timeRow(r);
    expect(validate(Time, row).ok).toBe(true);
    expect(row).toMatchObject({ start: "2026-11-06T21:00:00.000Z", zone: ZONE, civilStart: "2026-11-06T15:00", precision: "instant", rrule: null });
  });

  it("tells time words from other words", () => {
    for (const words of ["Friday at 3", "in March", "next spring", "tonight", "11/20", "by Fridays", "in two weeks", "at noon"]) expect(looksLikeTime(words), words).toBe(true);
    for (const words of ["in college", "when we were kids", "", "at the dentist"]) expect(looksLikeTime(words), words).toBe(false);
  });

  it("names the day words were said on", () => {
    expect(spokenOnLabel(WED_10AM, ZONE)).toBe("Wednesday, Nov 4");
  });
});
