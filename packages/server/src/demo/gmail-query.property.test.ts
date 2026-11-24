/**
 * The simulator reads the queries the product writes (brief 054 design, correctness property 16; R9.3, R13.3).
 * 1,000 runs.
 *   FOR ALL `MailQuery` q and fixtures (generated mail lines, and every fixture in FIXTURES with a demo profile),
 *   world starts, zones and list sizes:
 *   `listMessages` over `gmailQuery(q)` answers exactly the messages an oracle selects from the lines (From
 *   substring, every word in the subject, the body or the From, `after` and `before` in epoch seconds, `is:unread`,
 *   the four exclusions), newest first (ties by ID) and cut to the clamped size;
 *   AND `in:sent to:<a>` answers exactly the sent lines whose recipients hold `a`;
 *   AND a query that holds any form the product does not write is refused, never answered loosely.
 */
import { MAIL_QUERY_WORDS_MAX, type MailQuery, gmailQuery, quotedTerm } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GoogleCallError, MESSAGES_LIST_MAX } from "../google/port";
import { cloneWorldStart, localDate, relInstant } from "../seed/clock";
import type { DemoProfile, MailLine, SeedFixture } from "../seed/fixture";
import { FIXTURES } from "../seed/persona";
import { SEED_ZONES } from "../testing/seed";
import { parseGmailQuery } from "./gmail-query";
import { simulatedGoogle } from "./sim-google";
import { simToken } from "./token";

const RUNS = { numRuns: 1000 };
const GEN_ID = "seed-test-sim-query-00000000000000000000000";
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

const mailSpec = fc.record({
  day: fc.integer({ min: -30, max: 3 }),
  minute: fc.integer({ min: 0, max: 1439 }),
  fromSelf: fc.boolean(),
  bulk: fc.boolean(),
  from: fc.constantFrom(...PEOPLE),
  to: fc.uniqueArray(fc.constantFrom(...PEOPLE.map((p) => p.address)), { minLength: 1, maxLength: 3 }),
  subject: words(1, 6),
  body: words(1, 12),
  unread: fc.option(fc.boolean(), { nil: undefined }),
});

const generated: fc.Arbitrary<SeedFixture> = fc.array(mailSpec, { maxLength: 60, size: "max" }).map((ms) => ({
  id: GEN_ID,
  origin: "authored",
  windowDays: 21,
  demo: PROFILE,
  lines: ms.map(
    (m, i): MailLine => ({
      kind: "mail",
      id: `mail-${i}`,
      at: { day: m.day, minute: m.minute },
      bulk: m.bulk,
      fromSelf: m.fromSelf,
      from: m.fromSelf ? { name: PROFILE.displayName, address: SELF } : m.from,
      to: m.fromSelf ? m.to : [SELF],
      subject: m.subject,
      body: m.body,
      thread: `t-${i % 5}`,
      ...(m.unread === undefined || m.fromSelf ? {} : { unread: m.unread }),
    }),
  ),
}));

const demoFixtures = [...FIXTURES.values()].filter((f) => f.demo !== undefined);
const fixture = demoFixtures.length === 0 ? generated : fc.oneof({ weight: 3, arbitrary: generated }, { weight: 1, arbitrary: fc.constantFrom(...demoFixtures) });
const visit = fc.record({ zone: fc.constantFrom(...SEED_ZONES), opsNow: fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2028, 11, 31) }) });

/** A term the owner might name: a person, a fragment of one, a word from the mail, or anything at all. */
const term = fc.oneof(
  fc.constantFrom(...PEOPLE.flatMap((p) => [p.name, p.address, p.name.split(" ")[0]!, p.address.split("@")[1]!]), "TEST PERSON", "friend"),
  fc.constantFrom(...WORDS, "FUEL", "lau", "nothing here"),
  fc.string({ maxLength: 12 }),
);
const DAY = 86_400_000;
const mailQuery = (worldStart: number): fc.Arbitrary<MailQuery> =>
  fc.record({
    from: fc.option(term, { nil: null }),
    words: fc.array(term, { maxLength: MAIL_QUERY_WORDS_MAX + 2 }),
    afterMs: fc.option(fc.integer({ min: Math.max(0, worldStart - 35 * DAY), max: worldStart + 5 * DAY }), { nil: null }),
    beforeMs: fc.option(fc.integer({ min: Math.max(0, worldStart - 35 * DAY), max: worldStart + 5 * DAY }), { nil: null }),
    unread: fc.boolean(),
  });
const size = fc.oneof(fc.integer({ min: -3, max: MESSAGES_LIST_MAX + 10 }), fc.constantFrom(0.5, Number.NaN));
const clamp = (n: number) => (Number.isInteger(n) ? Math.min(Math.max(n, 1), MESSAGES_LIST_MAX) : 1);

/** The oracle's view of one line: what Gmail would hold, worked out from the line alone. */
function oracleRows(f: SeedFixture, worldStart: number, zone: string) {
  const friday = localDate(worldStart, zone);
  return f.lines
    .filter((l): l is MailLine => l.kind === "mail")
    .map((l, i) => ({ id: `m${i.toString(36).padStart(4, "0")}`, l, at: relInstant(friday, l.at, zone) }));
}
const inner = (t: string | null) => (t === null ? null : t.slice(1, -1).toLowerCase());
const newestFirst = (a: { id: string; at: number }, b: { id: string; at: number }) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

describe("the simulated Gmail search reads what the product writes", () => {
  it("answers gmailQuery exactly as the lines say", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fixture, visit).chain(([f, v]) => fc.tuple(fc.constant(f), fc.constant(v), size, mailQuery(cloneWorldStart(v.opsNow, v.zone)))),
        async ([f, v, max, q]) => {
          const worldStart = cloneWorldStart(v.opsNow, v.zone);
          const sim = simulatedGoogle(new Map([[f.id, f]]));
          const access = simToken({ kind: "access", fixtureId: f.id, worldStart, zone: v.zone });
          const got = await sim.listMessages(access, gmailQuery(q), max);

          const from = q.from === null ? null : inner(quotedTerm(q.from));
          const ws = q.words
            .slice(0, MAIL_QUERY_WORDS_MAX)
            .map((w) => inner(quotedTerm(w)))
            .filter((w): w is string => w !== null);
          const after = q.afterMs === null ? null : Math.floor(q.afterMs / 1000) * 1000;
          const before = q.beforeMs === null ? null : Math.floor(q.beforeMs / 1000) * 1000;
          const want = oracleRows(f, worldStart, v.zone)
            .filter(({ l, at }) => {
              const sender = `${l.from.name} <${l.from.address}>`.toLowerCase();
              if (from !== null && !sender.includes(from)) return false;
              const hay = [l.subject, l.body, `${l.from.name} <${l.from.address}>`].map((s) => s.toLowerCase());
              if (!ws.every((w) => hay.some((h) => h.includes(w)))) return false;
              if (after !== null && at < after) return false;
              if (before !== null && at >= before) return false;
              if (q.unread && !(l.unread === true && !l.fromSelf)) return false;
              return true;
            })
            .sort(newestFirst)
            .slice(0, clamp(max))
            .map((r) => r.id);
          expect(got.map((m) => m.id)).toEqual(want);
          for (const m of got) expect(m.id).toMatch(/^[A-Za-z0-9]{1,64}$/);
        },
      ),
      RUNS,
    );
  }, 600_000);

  it("answers the trust check's sent search exactly", async () => {
    const address = fc.oneof(fc.constantFrom(...PEOPLE.map((p) => p.address), SELF, "nobody@nowhere.example"));
    await fc.assert(
      fc.asyncProperty(fixture, visit, address, size, async (f, v, a, max) => {
        const worldStart = cloneWorldStart(v.opsNow, v.zone);
        const sim = simulatedGoogle(new Map([[f.id, f]]));
        const access = simToken({ kind: "access", fixtureId: f.id, worldStart, zone: v.zone });
        const got = await sim.listMessages(access, `in:sent to:${a}`, max);
        const want = oracleRows(f, worldStart, v.zone)
          .filter(({ l }) => l.fromSelf && l.to.some((t) => t.trim().toLowerCase() === a))
          .sort(newestFirst)
          .slice(0, clamp(max))
          .map((r) => r.id);
        expect(got.map((m) => m.id)).toEqual(want);
      }),
      RUNS,
    );
  }, 600_000);

  it("refuses any query that holds a form the product does not write", async () => {
    const foreign = fc.constantFrom("subject:launch", "has:attachment", "in:spam", "-is:unread", "label:work", "OR", "{a b}", "(rocket)", "larger:1M", "from:pat", "-from:\"x\"", "after:2026/01/01", "  ", "");
    await fc.assert(
      fc.asyncProperty(visit.chain((v) => mailQuery(cloneWorldStart(v.opsNow, v.zone))), foreign, fc.nat(), async (q, bad, at) => {
        // Split between terms only: a quoted term may hold spaces.
        const parts = gmailQuery(q).match(/(?:from:)?"[^"]*"|\S+/g)!;
        parts.splice(at % (parts.length + 1), 0, bad);
        const text = parts.join(" ");
        expect(parseGmailQuery(text)).toBeNull();
        // A fixture the token names, so the refusal comes from the query and nothing else.
        const empty: SeedFixture = { id: GEN_ID, origin: "authored", windowDays: 21, demo: PROFILE, lines: [] };
        const sim = simulatedGoogle(new Map([[GEN_ID, empty]]));
        const access = simToken({ kind: "access", fixtureId: GEN_ID, worldStart: 0, zone: "UTC" });
        await expect(sim.listMessages(access, gmailQuery(q), 10)).resolves.toEqual([]);
        const refused = await sim.listMessages(access, text, 10).then(
          () => null,
          (e: unknown) => e,
        );
        expect(refused).toBeInstanceOf(GoogleCallError);
        expect((refused as GoogleCallError).problem).toBe("refused");
        expect((refused as GoogleCallError).definite).toBe(true);
      }),
      RUNS,
    );
  }, 600_000);
});
