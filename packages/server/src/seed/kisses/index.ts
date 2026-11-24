/**
 * The demo persona (brief 054): Jeffrey Kisses, the second seeded fixture, played by a visitor who presses
 * Kiroween Demo. Its `demo` profile is what pairs it with an anonymous tenant and what the simulated bank and Google
 * answer from.
 *
 * This is the stub that lands with the fixture types (part C0): no lines yet, and a placeholder profile that passes
 * the builder's demo checks. The persona's own lines and profile are written later (part E) in `turns.ts`,
 * `mail.ts`, `bulk.ts`, `calendar.ts`, `bank.ts` and `profile.ts`, as `seed/persona/` is laid out.
 *
 * This folder imports only `../fixture`, so it never forms a cycle with `seed/persona/`, which registers it.
 */
import type { BankLine, CalendarLine, DemoProfile, MailLine, SeedFixture, TurnLine } from "../fixture";

/** The route's `fixtureId` for this persona: a fixed 43-character ID shape the browser can send (23 + 20). */
export const KISSES_FIXTURE_ID = "seed-persona-kisses-v1-00000000000000000000";

const TURNS: TurnLine[] = [];
const MAIL: MailLine[] = [];
const BULK: MailLine[] = [];
const CALENDAR: CalendarLine[] = [];
const BANK: BankLine[] = [];

/** Placeholder until part E: invented values that pass the builder's demo checks. */
const PROFILE: DemoProfile = {
  displayName: "Jeffrey Kisses",
  bank: {
    itemId: "sim-item-kisses-0001",
    institutionId: "sim-ins-0001",
    institutionName: "Placeholder Savings",
    accounts: [{ accountId: "sim-acct-checking-0001", name: "Everyday Checking", mask: "0001", type: "depository", subtype: "checking" }],
  },
  google: { email: "jeffrey@kisses.example" },
};

export const KISSES: SeedFixture = {
  id: KISSES_FIXTURE_ID,
  origin: "authored",
  windowDays: 21,
  lines: [...TURNS, ...MAIL, ...BULK, ...CALENDAR, ...BANK],
  demo: PROFILE,
};
