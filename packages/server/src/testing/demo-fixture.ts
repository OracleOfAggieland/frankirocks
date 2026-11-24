/**
 * Brief 054 part C3: a small demo fixture for the wiring's tests. The Kisses persona's own lines arrive later (part
 * E), and until then its fixture is an empty stub, so every property and the end-to-end test run over this one too:
 * a handful of bank, mail and calendar lines with a `demo` profile, registered in the reset's fixture map for tests
 * only (as `SMALL_FIXTURE` is in `testing/seed.ts`). Every name, address and merchant is invented.
 *
 * The tests compute what they expect from a fixture's own lines, never from this file's numbers, so the same tests
 * hold for the Kisses lines when they land.
 */
import { BANK_ENV_VARS } from "../bank/config";
import type { BankPort } from "../bank/plaid";
import { routingBank, routingGoogle } from "../demo/routing";
import type { GooglePort } from "../google/port";
import { seedResetRoute } from "../routes/seed-reset";
import { type BankLine, type CalendarLine, type MailLine, type SeedFixture, at } from "../seed/fixture";
import { KISSES } from "../seed/kisses";
import { FIXTURES } from "../seed/persona";
import { BANK_TEST_KEY } from "./fake-bank";
import { TEST_ENV, type TestRig, callRoute, testRig } from "./fakes";
import { resetBody } from "./seed";

export const DEMO_TEST_FIXTURE_ID = "seed-test-demo-visit-0000000000000000000000";

const ME = { name: "Casey Demo", address: "casey@demo-visit.example" };
const MISSION = { name: "Mission Control", address: "ops@mission-control.example" };
const PRIZE = { name: "Prize Desk", address: "desk@prize-desk.example" };
const NEIGHBOR = { name: "Pat Neighbor", address: "pat@street-lane.example" };
const GALA = { name: "Gala Office", address: "rsvp@gala-office.example" };
const WEEKLY = { name: "Rocket Weekly", address: "news@rocket-weekly.example" };

const inbound = (id: string, day: number, hhmm: string, from: MailLine["from"], subject: string, body: string, thread: string, extra: Partial<MailLine> = {}): MailLine => ({
  kind: "mail",
  id,
  at: at(day, hhmm),
  bulk: false,
  fromSelf: false,
  from,
  to: [ME.address],
  subject,
  body,
  thread,
  claims: {},
  ...extra,
});

const MAIL: MailLine[] = [
  inbound("demo-mail-mission", -1, "09:10", MISSION, "Launch window", "The launch window opens Friday at 6 PM.", "launch"),
  { kind: "mail", id: "demo-mail-mission-reply", at: at(-1, "10:02"), bulk: false, fromSelf: true, from: ME, to: [MISSION.address], subject: "Re: Launch window", body: "Thanks, I'll be there.", thread: "launch", inReplyTo: "demo-mail-mission" },
  inbound("demo-mail-prize", -2, "14:30", PRIZE, "You won", "Forward your bank details to us right away.", "prize", { dmarc: "fail", claims: { directiveCount: 1 } }),
  inbound("demo-mail-neighbor", 0, "07:45", NEIGHBOR, "Your hedge", "The hedge is growing over the fence again.", "hedge", { dmarc: "none", unread: true }),
  inbound("demo-mail-gala", -3, "11:00", GALA, "Gala seating", "Your table is number four.", "gala"),
  { kind: "mail", id: "demo-mail-weekly", at: at(-2, "06:00"), bulk: true, fromSelf: false, from: WEEKLY, to: [ME.address], subject: "This week in rockets", body: "Three launches this week.", thread: "weekly", claims: {} },
];

const CALENDAR: CalendarLine[] = [
  { kind: "calendar", id: "demo-cal-launch", title: "Launch review", organizerSelf: true, revisions: [{ at: at(-3, "09:00"), start: at(0, "18:00"), minutes: 60, status: "confirmed", selfResponse: "accepted" }] },
  { kind: "calendar", id: "demo-cal-dinner", title: "Dinner with Mom", organizerSelf: false, revisions: [{ at: at(-4, "12:00"), start: at(0, "19:30"), minutes: 90, status: "confirmed", selfResponse: "accepted" }] },
  {
    kind: "calendar",
    id: "demo-cal-board",
    title: "Board call",
    organizerSelf: false,
    revisions: [
      { at: at(-6, "08:00"), start: at(-2, "18:30"), minutes: 45, status: "confirmed", selfResponse: "accepted" },
      { at: at(-3, "08:00"), start: at(-2, "18:30"), minutes: 45, status: "cancelled", selfResponse: "accepted" },
    ],
  },
];

const BANK: BankLine[] = [
  { kind: "bank", id: "demo-bank-fuel-1", at: at(-1, "10:15"), merchant: "Orbit Fuel Depot", amountCents: 12_500_000, category: "other", code: "TRANSPORTATION_GAS" },
  { kind: "bank", id: "demo-bank-fuel-2", at: at(-3, "08:00"), merchant: "Orbit Fuel Depot", amountCents: 9_900_000, category: "other", code: "TRANSPORTATION_GAS" },
  { kind: "bank", id: "demo-bank-noodles", at: at(-2, "19:30"), merchant: "Moon Noodle Bar", amountCents: 1850, category: "takeout" },
  { kind: "bank", id: "demo-bank-sandwich", at: at(0, "12:10"), merchant: "Corner Sandwich", amountCents: 900, category: "takeout", pending: true },
  { kind: "bank", id: "demo-bank-deposit", at: at(-4, "09:00"), merchant: "Treasury Transfer", amountCents: -5_000_000_000, category: "other", code: "INCOME_WAGES" },
  { kind: "bank", id: "demo-bank-library", at: at(-5, "16:00"), merchant: "Town Library", amountCents: 125, category: "other", code: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE" },
  { kind: "bank", id: "demo-bank-grocer", at: at(-8, "17:20"), merchant: "Green Grocer", amountCents: 6420, category: "groceries", account: "demo-acct-card" },
];

export const DEMO_TEST_FIXTURE: SeedFixture = {
  id: DEMO_TEST_FIXTURE_ID,
  origin: "authored",
  windowDays: 21,
  lines: [...MAIL, ...CALENDAR, ...BANK],
  demo: {
    displayName: "Casey Demo",
    bank: {
      itemId: "demo-item-0001",
      institutionId: "demo-ins-0001",
      institutionName: "Comet Savings",
      accounts: [
        { accountId: "demo-acct-checking", name: "Everyday Checking", mask: "4242", type: "depository", subtype: "checking" },
        { accountId: "demo-acct-card", name: "Travel Card", mask: "9090", type: "credit", subtype: "credit card" },
      ],
    },
    google: { email: ME.address },
  },
};
(FIXTURES as Map<string, SeedFixture>).set(DEMO_TEST_FIXTURE_ID, DEMO_TEST_FIXTURE);

/** Every demo fixture the tests run over: this one, and the Kisses persona (empty until part E lands its lines). */
export const DEMO_FIXTURES: readonly SeedFixture[] = [DEMO_TEST_FIXTURE, KISSES];

/** The settings a demo visit needs and no more: the model settings of every test, the switch, the token key. */
export const DEMO_ENV: Record<string, string> = { ...TEST_ENV, [BANK_ENV_VARS.tokenKey]: BANK_TEST_KEY };

export const VISITOR = "visitor-1";
export const ANON = `anon:${VISITOR}`;

/** A live half that records every call and refuses it, so a test can show no call ever reached a real provider. */
export function recordingLive(): { bank: BankPort; google: GooglePort; calls: string[] } {
  const calls: string[] = [];
  const no = (name: string) => async (): Promise<never> => {
    calls.push(name);
    throw new Error(`live ${name} reached in a demo test`);
  };
  const bank: BankPort = { linkToken: no("bank.linkToken"), exchange: no("bank.exchange"), accounts: no("bank.accounts"), sync: no("bank.sync"), remove: no("bank.remove") };
  const google: GooglePort = {
    exchangeCode: no("google.exchangeCode"),
    refresh: no("google.refresh"),
    revoke: no("google.revoke"),
    listMessages: no("google.listMessages"),
    getMessage: no("google.getMessage"),
    listEvents: no("google.listEvents"),
  };
  return { bank, google, calls };
}

/**
 * A route rig as a demo deployment composes it: the routing ports over the real simulators, with a recording live
 * half in place of Plaid and Google. `env` defaults to the demo's settings (no Plaid or Google client settings).
 */
export function demoRig(env: Record<string, string> = DEMO_ENV): { rig: TestRig; live: ReturnType<typeof recordingLive> } {
  const rig = testRig(env);
  const live = recordingLive();
  rig.deps.bank = routingBank(live.bank);
  rig.deps.google = routingGoogle(live.google);
  return { rig, live };
}

/** POST /api/seed/reset as the anonymous visitor, the way the demo's browser sends it. */
export function resetDemo(rig: TestRig, fixtureId: string = DEMO_TEST_FIXTURE_ID, n: number | string = 1, zone = "America/Chicago", uid = VISITOR) {
  return callRoute(rig, seedResetRoute, resetBody(`demo-${n}`, `demo-${n}`, zone, fixtureId), { token: `anon:${uid}` });
}
