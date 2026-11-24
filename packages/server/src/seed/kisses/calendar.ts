/**
 * Jeffrey's calendar (docs/briefs/054-persona-bible.md, "Calendar events"). 26 lines.
 *
 * Hero arithmetic, meeting half (TAKEOUT_LATE_V1 on the clone's Friday, day 0 at 08:40):
 * - Window: days -21 to -1. An accepted, confirmed, opaque, timed meeting at or after 18:00 makes a night late.
 * - The five late nights with a takeout order are days -18, -16, -11, -9 and -4: the 18:30 propellant budget review,
 *   the 18:45 telemetry readout, the 18:30 review, the 18:45 readout and the 18:30 review.
 * - Day -13 (the sandwich at lunch) has no late meeting. Day -2 has an accepted 17:00 walkthrough and a declined
 *   18:45 telemetry readout, so it is not late.
 * - Decoys: the 18:15 countdown rehearsal on day -22 (outside the window, with the pending order), the 18:00 town
 *   hall on day -17 (restaurant dinner), and late meetings on nights with no takeout (days -17, -15, -10, -8, -1).
 * - Day 0 holds three events (10:00, 12:30 and the 19:15 launch window review, a late meeting tonight). Day 6 holds
 *   the countdown rehearsal at 18:15 for the "Thursday, 6 PM" bolt.
 * - The launch window review has three revisions, each matching a Mission Control mail at the same minute.
 * - Every revision's `at` is before day 0 at 08:40.
 */
import { type CalendarLine, type CalendarRevision, at } from "../fixture";

const once = (day: number, hhmm: string, minutes: number, extra: Partial<CalendarRevision> = {}): CalendarRevision[] => [
  { at: at(day - 7, "09:00"), start: at(day, hhmm), minutes, status: "confirmed", selfResponse: "accepted", transparency: "opaque", ...extra },
];

const event = (id: string, title: string, revisions: CalendarRevision[], organizerSelf = false): CalendarLine => ({ kind: "calendar", id, title, organizerSelf, revisions });

export const CALENDAR: CalendarLine[] = [
  // Countdown rehearsal: 18:15, five Thursdays (day -22 is the decoy outside the window; day 6 is the bolt).
  event("cal-countdown-0", "Countdown rehearsal", once(-22, "18:15", 45)),
  event("cal-countdown-1", "Countdown rehearsal", once(-15, "18:15", 45)),
  event("cal-countdown-2", "Countdown rehearsal", once(-8, "18:15", 45)),
  event("cal-countdown-3", "Countdown rehearsal", once(-1, "18:15", 45)),
  event("cal-countdown-4", "Countdown rehearsal", once(6, "18:15", 45)),
  // Propellant budget review: 18:30 on Mondays.
  event("cal-budget-1", "Propellant budget review", once(-18, "18:30", 60)),
  event("cal-budget-2", "Propellant budget review", once(-11, "18:30", 60)),
  event("cal-budget-3", "Propellant budget review", once(-4, "18:30", 60)),
  event("cal-budget-4", "Propellant budget review", once(3, "18:30", 60)),
  // Other late meetings.
  event("cal-townhall", "Hangar crew town hall", once(-17, "18:00", 60)),
  event("cal-telemetry-1", "Telemetry readout", once(-16, "18:45", 45)),
  event("cal-telemetry-2", "Telemetry readout", once(-9, "18:45", 45)),
  // Declined: day -2 is not a late night.
  event("cal-telemetry-3", "Telemetry readout", once(-2, "18:45", 45, { selfResponse: "declined" })),
  event("cal-moon-garden", "Moon garden planning", once(-10, "19:00", 60)),
  // Accepted but early: day -2 is not a late night.
  event("cal-walkthrough", "Hangar walkthrough", once(-2, "17:00", 45)),
  // The launch window review moves three times, each revision matching a Mission Control mail.
  event("cal-launch-window", "Launch window review", [
    { at: at(-9, "09:00"), start: at(0, "18:00"), minutes: 60, status: "confirmed", selfResponse: "accepted", transparency: "opaque" },
    { at: at(-4, "10:00"), start: at(0, "18:30"), minutes: 60, status: "confirmed", selfResponse: "accepted", transparency: "opaque" },
    { at: at(-1, "16:00"), start: at(0, "19:15"), minutes: 60, status: "confirmed", selfResponse: "accepted", transparency: "opaque" },
  ]),
  // The clone's Friday.
  event("cal-depot", "Fuel depot walkthrough", once(0, "10:00", 60)),
  event("cal-tobias-lunch", "Lunch with Tobias", once(0, "12:30", 60), true),
  // Sundays at eleven.
  event("cal-mom-1", "Call Mom", once(-19, "11:00", 30), true),
  event("cal-mom-2", "Call Mom", once(-12, "11:00", 30), true),
  event("cal-mom-3", "Call Mom", once(-5, "11:00", 30), true),
  event("cal-mom-4", "Call Mom", once(2, "11:00", 30), true),
  // Saturdays: chess is free time.
  event("cal-chess-1", "Chess with Tobias", once(-20, "14:00", 120, { transparency: "transparent" }), true),
  event("cal-chess-2", "Chess with Tobias", once(-13, "14:00", 120, { transparency: "transparent" }), true),
  event("cal-chess-3", "Chess with Tobias", once(-6, "14:00", 120, { transparency: "transparent" }), true),
  event("cal-library", "Return library books", once(-6, "10:30", 30, { transparency: "transparent" }), true),
];
