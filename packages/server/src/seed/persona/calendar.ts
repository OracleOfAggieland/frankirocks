/**
 * Riley's calendar. The interview moved from Thursday 14:00 to Friday 14:00 (two revisions of one event). Four
 * accepted, timed, busy meetings start at or after 18:00 on the four late takeout nights (spec §10). Decoys: a
 * declined 18:30 meeting on the $36 night, an accepted 17:00 retro, and late meetings on nights with no takeout.
 */
import { type CalendarLine, type CalendarRevision, at } from "../fixture";

const once = (day: number, hhmm: string, minutes: number, extra: Partial<CalendarRevision> = {}): CalendarRevision[] => [
  { at: at(day - 7, "09:00"), start: at(day, hhmm), minutes, status: "confirmed", selfResponse: "accepted", transparency: "opaque", ...extra },
];

const event = (id: string, title: string, revisions: CalendarRevision[], organizerSelf = false): CalendarLine => ({ kind: "calendar", id, title, organizerSelf, revisions });

export const CALENDAR: CalendarLine[] = [
  event("cal-interview", "Tessellate Labs final interview", [
    { at: at(-11, "10:05"), start: at(-1, "14:00"), minutes: 60, status: "confirmed", selfResponse: "accepted", transparency: "opaque" },
    { at: at(-1, "16:05"), start: at(0, "14:00"), minutes: 60, status: "confirmed", selfResponse: "accepted", transparency: "opaque" },
  ]),
  // The four late-meeting nights.
  event("cal-ops-review", "Ops review: West Coast carriers", once(-17, "18:30", 60)),
  event("cal-vendor-call", "Vendor call: Marrow Line Shipping", once(-15, "18:00", 60)),
  event("cal-quarter-planning", "Quarter planning", once(-10, "18:30", 60)),
  event("cal-escalation", "Carrier escalation call", once(-8, "18:15", 45)),
  // Decoys: declined late meeting on the $36 night; late meetings on nights without takeout; an early-evening retro.
  event("cal-night-dispatch", "Late sync with night dispatch", once(-3, "18:30", 45, { selfResponse: "declined" })),
  event("cal-dock-review", "Dock scheduling review", once(-16, "18:30", 60)),
  event("cal-dispatch-handoff", "Weekly dispatch handoff", once(-1, "18:00", 45)),
  event("cal-retro", "Team retro", once(-9, "17:00", 60)),
  // Daytime.
  event("cal-ines-1", "1:1 with Ines", once(-18, "10:00", 30)),
  event("cal-ines-2", "1:1 with Ines", once(-11, "10:00", 30)),
  event("cal-ines-3", "1:1 with Ines", once(-4, "10:00", 30)),
  event("cal-handover", "Shift handover with Theo", once(-14, "09:30", 30)),
  event("cal-planning", "Route planning working session", once(-13, "15:00", 90)),
  event("cal-mara-lunch", "Lunch with Mara", once(-12, "12:00", 90), true),
  event("cal-training-run", "Gullwing 10K training run", once(-6, "08:00", 60, { transparency: "transparent" }), true),
  event("cal-basketball", "Pickup basketball", once(-5, "11:00", 90, { transparency: "transparent" }), true),
  // Ahead of the clone's Friday.
  event("cal-report", "Carrier report due to Ines", once(3, "09:00", 30), true),
  event("cal-mara-move", "Help Mara move", once(15, "10:00", 240, { selfResponse: "tentative" }), true),
];
