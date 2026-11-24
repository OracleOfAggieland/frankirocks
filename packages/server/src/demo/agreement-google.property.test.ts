/**
 * Agreement, mail and calendar (brief 054 design, correctness property 2; R9.4, R9.5, R12.3, R12.4). 1,000 runs.
 *   FOR ALL mail and calendar lines (generated lines of the fixture types, and every line of every fixture in
 *   FIXTURES with a demo profile), world starts and zones:
 *   the `GmailMessage` the simulator answers, read by `mailContent`, has the same sender, address, subject, body,
 *   instant and recipients as the Evidence `buildMail` builds for that line, the same own-mail and bulk marks, and
 *   (inbound mail) the same `senderAuth`;
 *   AND the event the simulator lists, read by `eventContent`, has the same title, start, length, status, response,
 *   transparency and organizer as the Evidence `buildCalendar` builds for the line's last revision, and a line whose
 *   last revision is cancelled is not listed;
 *   AND the refreshed access token is itself a simulator token carrying the same fixture, world start and zone.
 */
import { type Evidence, tsFromMs } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createHasher } from "../crypto";
import { eventContent } from "../google/calendar";
import type { GoogleConfig } from "../google/config";
import { mailContent, parseAddress } from "../google/mail";
import { CALENDAR_SCOPE, GMAIL_SCOPE } from "../google/oauth";
import { buildSeed } from "../seed/build";
import { cloneWorldStart } from "../seed/clock";
import type { CalendarLine, DemoProfile, MailLine, SeedFixture } from "../seed/fixture";
import { FIXTURES } from "../seed/persona";
import { FAKE_HMAC_KEY } from "../testing/fakes";
import { SEED_ZONES } from "../testing/seed";
import { simEventId, simMessages, simulatedGoogle } from "./sim-google";
import { layoutOf } from "./layout";
import { readSimToken, simToken } from "./token";

const RUNS = { numRuns: 1000 };
const hasher = createHasher(FAKE_HMAC_KEY);
const CONFIG = {} as GoogleConfig;
const GEN_ID = "seed-test-sim-google-0000000000000000000000";
const SELF = "test.person@example.test";

const PROFILE: DemoProfile = {
  displayName: "Test Person",
  bank: { itemId: "sim-item-1", institutionId: "sim-ins-1", institutionName: "Test Savings", accounts: [{ accountId: "acct-a", name: "Checking", mask: null, type: "depository", subtype: null }] },
  google: { email: SELF },
};

const PEOPLE = [
  { name: "Pat Friend", address: "pat@friend.test" },
  { name: "Mission Control", address: "ops@mission.example" },
  { name: "Dana O'Brien", address: "dana.obrien@mail.example" },
  { name: "Rocket Club", address: "news@rocketclub.example" },
  { name: "Sam", address: "sam+notes@friend.test" },
];
const WORDS = ["launch", "fuel", "dinner", "Friday", "budget", "rocket", "meeting", "noon", "orbit", "groceries", "thanks", "plan", "today"];
const words = (min: number, max: number) => fc.array(fc.constantFrom(...WORDS), { minLength: min, maxLength: max }).map((w) => w.join(" "));
/** A body as people write it: lines of words, one newline between them, no trailing spaces. */
const body = fc.array(words(1, 8), { minLength: 1, maxLength: 4 }).map((ls) => ls.join("\n"));

const rel = fc.record({ day: fc.integer({ min: -30, max: 3 }), minute: fc.integer({ min: 0, max: 1439 }) });

const mailSpec = fc.record({
  at: rel,
  fromSelf: fc.boolean(),
  bulk: fc.boolean(),
  from: fc.constantFrom(...PEOPLE),
  to: fc.uniqueArray(fc.constantFrom(...PEOPLE.map((p) => p.address)), { minLength: 1, maxLength: 3 }),
  cc: fc.boolean(),
  subject: words(1, 6),
  body,
  thread: fc.constantFrom("t-launch", "t-dinner", "t-budget", "t-news"),
  replyTo: fc.option(fc.nat(40), { nil: undefined }),
  dmarc: fc.option(fc.constantFrom("pass" as const, "fail" as const, "none" as const), { nil: undefined }),
  unread: fc.option(fc.boolean(), { nil: undefined }),
});

const revision = fc.record({
  at: rel,
  start: rel,
  minutes: fc.integer({ min: 0, max: 300 }),
  status: fc.constantFrom("confirmed" as const, "tentative" as const, "cancelled" as const),
  selfResponse: fc.constantFrom("accepted" as const, "tentative" as const, "declined" as const, "needsAction" as const, "none" as const),
  transparency: fc.option(fc.constantFrom("opaque" as const, "transparent" as const), { nil: undefined }),
});
const calendarSpec = fc.record({ dotted: fc.boolean(), title: words(1, 5), organizerSelf: fc.boolean(), revisions: fc.array(revision, { minLength: 1, maxLength: 3 }) });

const generated: fc.Arbitrary<SeedFixture> = fc.tuple(fc.array(mailSpec, { maxLength: 30, size: "max" }), fc.array(calendarSpec, { maxLength: 20, size: "max" })).map(([ms, cs]) => {
  const mail = ms.map(
    (m, i): MailLine => ({
      kind: "mail",
      id: `mail-${i}`,
      at: m.at,
      bulk: m.bulk,
      fromSelf: m.fromSelf,
      from: m.fromSelf ? { name: PROFILE.displayName, address: SELF } : m.from,
      to: m.fromSelf ? m.to : [SELF, ...(m.cc ? m.to.slice(0, 1) : [])],
      subject: m.subject,
      body: m.body,
      thread: m.thread,
      ...(m.replyTo !== undefined && m.replyTo < i ? { inReplyTo: `mail-${m.replyTo}` } : {}),
      ...(m.dmarc === undefined ? {} : { dmarc: m.dmarc }),
      ...(m.unread === undefined || m.fromSelf ? {} : { unread: m.unread }),
    }),
  );
  const calendar = cs.map(
    (c, i): CalendarLine => ({
      kind: "calendar",
      // A dot is outside Google's event-ID alphabet, so `simEventId` maps it; the index keeps IDs apart after mapping.
      id: c.dotted ? `cal.${i}` : `cal${i}x`,
      title: c.title,
      organizerSelf: c.organizerSelf,
      revisions: c.revisions.map((r) => ({ at: r.at, start: r.start, minutes: r.minutes, status: r.status, selfResponse: r.selfResponse, ...(r.transparency === undefined ? {} : { transparency: r.transparency }) })),
    }),
  );
  return { id: GEN_ID, origin: "authored", windowDays: 21, demo: PROFILE, lines: [...mail, ...calendar] };
});

const demoFixtures = [...FIXTURES.values()].filter((f) => f.demo !== undefined);
const fixture = demoFixtures.length === 0 ? generated : fc.oneof({ weight: 3, arbitrary: generated }, { weight: 1, arbitrary: fc.constantFrom(...demoFixtures) });
const visit = fc.record({ zone: fc.constantFrom(...SEED_ZONES), opsNow: fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2028, 11, 31) }) });

/** A display name that a From header can carry without quotes (atext and spaces): the stored sender is then the seed's. */
const PLAIN_NAME = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~ -]+$/;
const inline = (v: Evidence["body"]) => (v !== null && v.kind === "inline" ? v.text : null);

describe("the simulated Google agrees with the seed", () => {
  it("answers each message and event as the seeded Evidence holds it", async () => {
    await fc.assert(
      fc.asyncProperty(fixture, visit, async (f, v) => {
        const worldStart = cloneWorldStart(v.opsNow, v.zone);
        const fixtures = new Map([[f.id, f]]);
        const sim = simulatedGoogle(fixtures);
        const refresh = simToken({ kind: "refresh", fixtureId: f.id, worldStart, zone: v.zone });
        const refreshed = await sim.refresh(CONFIG, refresh);
        expect(readSimToken(refreshed.accessToken)).toEqual({ kind: "access", fixtureId: f.id, worldStart, zone: v.zone });
        expect(refreshed.scope).toEqual(expect.arrayContaining([GMAIL_SCOPE, CALENDAR_SCOPE]));
        const access = refreshed.accessToken;

        const seeded = await buildSeed(f, { uid: "owner-1", namespace: hasher.id(["ns", 1]), zone: v.zone, worldStart, opsNow: v.opsNow, core: { epoch: 1, policyRev: 1 }, hasher });
        const groups = new Map(seeded.groups.map((g) => [g.lineId, g.writes.map((w) => w.record as Evidence)]));
        const layout = layoutOf(readSimToken(access) as Exclude<ReturnType<typeof readSimToken>, null | "malformed">, fixtures)!;

        // Mail: every line, fetched through the port by the ID the simulator gives it.
        const mailLines = f.lines.filter((l): l is MailLine => l.kind === "mail");
        const listed = simMessages(layout);
        expect(listed.length).toBe(mailLines.length);
        for (const sm of listed) {
          const l = sm.line;
          const e = groups.get(l.id)![0]!;
          const got = mailContent(await sim.getMessage(access, sm.id));
          expect(got).not.toBeNull();
          const c = got!;
          expect(c.subject).toBe(e.subject);
          expect(c.body).toBe(inline(e.body));
          if (PLAIN_NAME.test(l.from.name)) expect(c.sender).toBe(e.sender);
          expect(parseAddress(c.sender ?? "")).toEqual(parseAddress(e.sender ?? ""));
          expect(c.senderAddress).toBe(l.from.address.trim().toLowerCase());
          expect(tsFromMs(c.occurredAtMs)).toBe(e.occurredAt);
          expect([...c.recipient].sort()).toEqual([...new Set(e.recipient.map((a) => a.trim().toLowerCase()))].sort());
          expect(c.fromSelf).toBe(e.authorship === "self");
          expect(c.bulk).toBe(e.route === "list");
          expect(c.unread).toBe(!l.fromSelf && l.unread === true);
          if (!l.fromSelf) expect(c.senderAuth).toBe(e.senderAuth);
        }

        // Calendar: everything listed over a window wide enough to hold every line, a few at a time.
        const calLines = f.lines.filter((l): l is CalendarLine => l.kind === "calendar");
        const items: unknown[] = [];
        let zone: string | null = null;
        let pageToken: string | undefined;
        for (let pages = 0; ; pages++) {
          expect(pages).toBeLessThan(1000);
          const page = await sim.listEvents(access, { timeMin: tsFromMs(worldStart - 60 * 86_400_000), timeMax: tsFromMs(worldStart + 30 * 86_400_000), max: 7, ...(pageToken === undefined ? {} : { pageToken }) });
          expect(page.items.length).toBeLessThanOrEqual(7);
          zone = page.timeZone;
          items.push(...page.items);
          if (page.nextPageToken === null) break;
          pageToken = page.nextPageToken;
        }
        expect(zone).toBe(v.zone);
        const events = new Map(items.map((i) => eventContent(i, zone!)).filter((e) => e !== null).map((e) => [e!.eventId, e!]));
        expect(events.size).toBe(items.length);
        let live = 0;
        for (const l of calLines) {
          const revs = groups.get(l.id)!;
          const last = revs[revs.length - 1]!;
          const o = last.observation as Extract<Evidence["observation"], { kind: "calendar" }>;
          const got = events.get(simEventId(l.id));
          if (o.status === "cancelled") {
            expect(got).toBeUndefined();
            continue;
          }
          live++;
          expect(got).toBeDefined();
          expect(got!.title).toBe(last.title);
          expect(tsFromMs(got!.startMs)).toBe(o.start);
          expect(tsFromMs(got!.endMs)).toBe(o.end);
          expect(got!.allDay).toBe(o.allDay);
          expect(got!.status).toBe(o.status);
          expect(got!.selfResponse).toBe(o.selfResponse);
          expect(got!.transparency).toBe(o.transparency);
          expect(got!.organizerSelf).toBe(o.organizerSelf);
          expect(got!.creatorSelf).toBe(o.creatorSelf);
        }
        expect(events.size).toBe(live);
      }),
      RUNS,
    );
  }, 600_000);
});
