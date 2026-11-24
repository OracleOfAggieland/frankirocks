/**
 * Agreement, bank (brief 054 design, correctness property 1; R8.3, R8.9, R12.2, R12.6). 1,000 runs.
 *   FOR ALL fixture bank line sets (generated, and every fixture in FIXTURES with a demo profile), zones, world
 *   starts, periods, groups and merchants:
 *   the money `moneyAnswer` gives over the rows `bankRowContent` builds from every page of `simulatedBank().sync`
 *   equals the sum of `amountCents` of the fixture lines that are posted, ordinary (`codeKind`), dated in the period,
 *   in the group (`groupMatches`) and, when a merchant is asked, named that merchant (spent and money back alike);
 *   AND each simulated row agrees field for field with the Evidence `buildSeed` builds from the same line (cents,
 *   purchase instant and civil date, posting instant, pending, category, merchant);
 *   AND a sync from the last cursor answers no additions;
 *   AND `centsOf(simAmount(c)) === c` for every integer |c| <= BANK_CENTS_MAX.
 */
import {
  BANK_CENTS_MAX,
  type Evidence,
  MONEY_GROUPS,
  MONEY_NOTE_ROWS_MAX,
  MONEY_PERIODS,
  type MoneyGroup,
  type MoneyRow,
  centsOf,
  codeKind,
  groupMatches,
  groupOf,
  moneyAnswer,
  moneyPeriod,
  tokenize,
  tsFromMs,
} from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BankConfig } from "../bank/config";
import type { PlaidTransaction } from "../bank/plaid";
import { bankRowContent } from "../bank/rows";
import { createHasher } from "../crypto";
import { buildSeed } from "../seed/build";
import { cloneWorldStart, localDate, relInstant } from "../seed/clock";
import { type BankLine, type DemoProfile, type SeedFixture, bankCodeOf } from "../seed/fixture";
import { FIXTURES } from "../seed/persona";
import { FAKE_HMAC_KEY } from "../testing/fakes";
import { SEED_ZONES } from "../testing/seed";
import { SIM_SYNC_PAGE, simAmount, simulatedBank } from "./sim-bank";
import { simToken } from "./token";

const RUNS = { numRuns: 1000 };
const hasher = createHasher(FAKE_HMAC_KEY);
const CONFIG = {} as BankConfig;
const GEN_ID = "seed-test-sim-bank-000000000000000000000000";

const PROFILE: DemoProfile = {
  displayName: "Test Person",
  bank: {
    itemId: "sim-item-1",
    institutionId: "sim-ins-1",
    institutionName: "Test Savings",
    accounts: [
      { accountId: "acct-a", name: "Checking", mask: "1111", type: "depository", subtype: "checking" },
      { accountId: "acct-b", name: "Card", mask: null, type: "credit", subtype: null },
    ],
  },
  google: { email: "test.person@example.test" },
};

const MERCHANTS = ["Rocket Fuel Diner", "Corner Cafe", "Green Grocer", "Moon Pizza", "Bolt Taxi", "Star Pharmacy", "Payroll Co"];
/** A code and the category it maps back to (build check 2); `undefined` takes the category's default. */
const CODES: [string | undefined, BankLine["category"]][] = [
  [undefined, "takeout"],
  [undefined, "groceries"],
  [undefined, "restaurant"],
  [undefined, "other"],
  ["FOOD_AND_DRINK_FAST_FOOD", "takeout"],
  ["FOOD_AND_DRINK_COFFEE", "restaurant"],
  ["FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK", "other"],
  ["TRANSFER_IN_DEPOSIT", "other"],
  ["TRANSFER_OUT_SAVINGS", "other"],
  ["INCOME_WAGES", "other"],
  ["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "other"],
  ["TRANSPORTATION_TAXIS_AND_RIDE_SHARES", "other"],
  ["GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE", "other"],
  ["ENTERTAINMENT_TV_AND_MOVIES", "other"],
];

const amount = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: -50_000, max: 200_000 }) },
  { weight: 1, arbitrary: fc.constantFrom(0, 1, -1, 99, BANK_CENTS_MAX, -BANK_CENTS_MAX, BANK_CENTS_MAX - 1) },
);

const line = fc.record({
  day: fc.integer({ min: -45, max: 0 }),
  minute: fc.integer({ min: 0, max: 1439 }),
  merchant: fc.constantFrom(...MERCHANTS),
  amountCents: amount,
  code: fc.constantFrom(...CODES),
  pending: fc.option(fc.boolean(), { nil: undefined }),
  account: fc.option(fc.constantFrom("acct-a", "acct-b"), { nil: undefined }),
});

const generated: fc.Arbitrary<SeedFixture> = fc.array(line, { maxLength: 260, size: "max" }).map((ls) => ({
  id: GEN_ID,
  origin: "authored",
  windowDays: 21,
  demo: PROFILE,
  lines: ls.map(
    (l, i): BankLine => ({
      kind: "bank",
      id: `bank-${i}`,
      at: { day: l.day, minute: l.minute },
      merchant: l.merchant,
      amountCents: l.amountCents,
      category: l.code[1],
      ...(l.code[0] === undefined ? {} : { code: l.code[0] }),
      ...(l.pending === undefined ? {} : { pending: l.pending }),
      ...(l.account === undefined ? {} : { account: l.account }),
    }),
  ),
}));

const demoFixtures = [...FIXTURES.values()].filter((f) => f.demo !== undefined);
const fixture = demoFixtures.length === 0 ? generated : fc.oneof({ weight: 3, arbitrary: generated }, { weight: 1, arbitrary: fc.constantFrom(...demoFixtures) });

const visit = fc.record({
  zone: fc.constantFrom(...SEED_ZONES),
  opsNow: fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2028, 11, 31) }),
  /** How long after the world start the question is asked (the world clock moves on with the bolts). */
  later: fc.integer({ min: 0, max: 9 * 86_400_000 }),
});

const question = fc.record({
  period: fc.constantFrom(...MONEY_PERIODS),
  group: fc.option(fc.constantFrom(...MONEY_GROUPS), { nil: null }),
  merchant: fc.option(fc.constantFrom(...MERCHANTS, "Rocket", "Pizza", "Cafe Corner"), { nil: null }),
});

/** Every page of a sync, from the first, as the real pull reads it. */
async function syncAll(sim: ReturnType<typeof simulatedBank>, token: string) {
  const added: PlaidTransaction[] = [];
  let cursor: string | null = null;
  for (let pages = 0; ; pages++) {
    expect(pages).toBeLessThan(10_000);
    const page = await sim.sync(CONFIG, token, cursor);
    expect(page.added.length).toBeLessThanOrEqual(SIM_SYNC_PAGE);
    expect(page.modified).toEqual([]);
    expect(page.removed).toEqual([]);
    added.push(...page.added);
    cursor = page.nextCursor;
    expect(page.updateStatus).toBe(page.hasMore ? "INITIAL_UPDATE_COMPLETE" : "HISTORICAL_UPDATE_COMPLETE");
    if (!page.hasMore) return { added, cursor };
  }
}

const bankLines = (f: SeedFixture) => f.lines.filter((l): l is BankLine => l.kind === "bank");

describe("the simulated bank agrees with the seed", () => {
  it("answers the same money, to the cent, as the fixture's own lines", async () => {
    await fc.assert(
      fc.asyncProperty(fixture, visit, question, async (f, v, q) => {
        const worldStart = cloneWorldStart(v.opsNow, v.zone);
        const sim = simulatedBank(new Map([[f.id, f]]));
        const token = simToken({ kind: "bank", fixtureId: f.id, worldStart, zone: v.zone });
        const { added, cursor } = await syncAll(sim, token);
        const lines = bankLines(f);
        expect(added.length).toBe(lines.length);

        // A sync from the last cursor adds nothing, so a second pull writes nothing.
        const again = await sim.sync(CONFIG, token, cursor);
        expect(again.added).toEqual([]);
        expect(again.hasMore).toBe(false);

        // Field for field against the seeded Evidence of the same line.
        const seeded = await buildSeed(f, { uid: "owner-1", namespace: hasher.id(["ns", 1]), zone: v.zone, worldStart, opsNow: v.opsNow, core: { epoch: 1, policyRev: 1 }, hasher });
        const evidenceOf = new Map(seeded.groups.map((g) => [g.lineId, g.writes[0]!.record as Evidence]));
        const ctx = { uid: "owner-1", connectorId: "conn-1", generation: 1, epoch: 1, policyRev: 1, opsNow: v.opsNow, hasher };
        const rows: MoneyRow[] = [];
        for (const t of added) {
          const c = bankRowContent(t, ctx, null, false);
          if (typeof c === "string") throw new Error(`simulated row skipped: ${c}`);
          const e = evidenceOf.get(t.transaction_id)!;
          expect(e.observation.kind).toBe("bank");
          const o = e.observation as Extract<Evidence["observation"], { kind: "bank" }>;
          expect(c.observation.amountCents).toBe(o.amountCents);
          expect(c.observation.currency).toBe(o.currency);
          expect(c.observation.pending).toBe(o.pending);
          expect(c.observation.category).toBe(o.category);
          expect(c.observation.purchaseAt.instant).toBe(o.purchaseAt.instant);
          expect(c.observation.purchaseAt.civilDate).toBe(o.purchaseAt.civilDate);
          expect(c.observation.postedAt).toBe(o.postedAt);
          expect(c.occurredAt).toBe(e.occurredAt);
          expect(c.title).toBe(e.title);
          rows.push({
            eid: t.transaction_id,
            rootKey: t.transaction_id,
            title: c.title,
            merchantKey: c.observation.merchantKey,
            amountCents: c.observation.amountCents,
            currency: c.observation.currency,
            pending: c.observation.pending,
            code: c.categoryCode,
            day: c.observation.purchaseAt.civilDate,
          });
        }

        // The oracle: the fixture's lines alone.
        const nowMs = worldStart + v.later;
        const range = moneyPeriod(q.period, nowMs, v.zone);
        const terms = q.merchant === null ? null : tokenize(q.merchant).filter((t) => t.length >= 2);
        const friday = localDate(worldStart, v.zone);
        let spent = 0;
        let back = 0;
        let kept = 0;
        for (const l of lines) {
          const code = bankCodeOf(l);
          if (codeKind(code) !== "ordinary" || !groupMatches(q.group as MoneyGroup | null, groupOf(code))) continue;
          if (terms !== null) {
            const words = new Set(tokenize(l.merchant));
            if (!terms.every((t) => words.has(t))) continue;
          }
          const day = localDate(relInstant(friday, l.at, v.zone), v.zone);
          if (day < range.from || day > range.to) continue;
          kept++;
          if (l.pending === true) continue;
          if (l.amountCents > 0) spent += l.amountCents;
          if (l.amountCents < 0) back += -l.amountCents;
        }

        const facts = moneyAnswer(rows, q, nowMs, v.zone, q.merchant ?? "");
        if (facts.kind === "narrow") {
          expect(kept).toBeGreaterThan(MONEY_NOTE_ROWS_MAX);
          return;
        }
        expect(facts.kind).toBe("answered");
        if (facts.kind !== "answered") return;
        expect(facts.parts.reduce((s, p) => s + p.spent.cents, 0)).toBe(spent);
        expect(facts.parts.reduce((s, p) => s + p.moneyBack.cents, 0)).toBe(back);
      }),
      RUNS,
    );
  }, 600_000);

  it("reads every whole-cents amount back exactly", () => {
    fc.assert(
      fc.property(fc.integer({ min: -BANK_CENTS_MAX, max: BANK_CENTS_MAX }), (c) => {
        expect(centsOf(simAmount(c))).toBe(c);
      }),
      RUNS,
    );
  }, 600_000);

  it("dates a purchase at its seeded instant", () => {
    // A fixed case the generators also reach: the instant is the seed's, as a TS.
    const f: SeedFixture = { id: GEN_ID, origin: "authored", windowDays: 21, demo: PROFILE, lines: [{ kind: "bank", id: "b", at: { day: -1, minute: 1140 }, merchant: "Moon Pizza", amountCents: 2450, category: "takeout" }] };
    const zone = "America/Chicago";
    const worldStart = cloneWorldStart(Date.UTC(2026, 10, 20, 18), zone);
    return simulatedBank(new Map([[f.id, f]]))
      .sync(CONFIG, simToken({ kind: "bank", fixtureId: f.id, worldStart, zone }), null)
      .then((p) => {
        expect(p.added[0]!.authorized_datetime).toBe(tsFromMs(relInstant(localDate(worldStart, zone), { day: -1, minute: 1140 }, zone)));
      });
  });
});
