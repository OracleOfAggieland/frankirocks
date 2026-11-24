/**
 * The Kisses persona loads (brief 054, design "Testing strategy"): the real loader raises nothing, the hero offer holds
 * on the clone's Friday in every zone the seed properties draw from, and the structural facts the demo depends on
 * hold, read from the fixture and from a loaded clone. In the manner of `seed/persona.test.ts`.
 */
import { BANK_CENTS_MAX, type Evidence, type Memory, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs, readCoreDocs } from "../../core-docs";
import { heroOffer } from "../../routes/tool-food";
import { paths } from "../../store/paths";
import { testRig } from "../../testing/fakes";
import { SEED_ZONES, evidenceOf } from "../../testing/seed";
import { SeedLoadError } from "../build";
import { listTenantRows } from "../clear";
import { addDays, cloneWorldStart, localDate, localMinute, weekdayOf } from "../clock";
import type { BankLine, CalendarLine, MailLine, TurnLine } from "../fixture";
import { heroSources } from "../hero-check";
import { loadSeed, seedCoreDocs } from "../load";
import { FIXTURES } from "../persona";
import { KISSES, KISSES_FIXTURE_ID } from ".";

const UID = "owner-1";
const ZONE = "America/New_York";

const lines = KISSES.lines;
const turns = lines.filter((l): l is TurnLine => l.kind === "turn");
const mail = lines.filter((l): l is MailLine => l.kind === "mail");
const calendar = lines.filter((l): l is CalendarLine => l.kind === "calendar");
const bank = lines.filter((l): l is BankLine => l.kind === "bank");

/** A clone the way a reset makes one: the core documents first, then the seed, then the clone's own core documents. */
async function clone(zone: string) {
  const rig = testRig();
  await ensureCoreDocs(UID, rig.deps, zone);
  const opsNow = rig.clock.read().opsClock.now;
  const worldStart = cloneWorldStart(opsNow, zone);
  const namespace = rig.deps.hasher.id(["ns", "kisses-test"]);
  const prior = await rig.store.transaction(UID, async (tx) => readCoreDocs(tx, UID));
  const rows = await loadSeed(rig.deps, UID, { fixture: KISSES, namespace, zone, worldStart, core: { epoch: prior.epoch.data.epoch, policyRev: prior.epoch.data.policyRev } });
  await rig.store.transaction(UID, async (tx) => {
    const core = await readCoreDocs(tx, UID);
    const docs = seedCoreDocs(UID, {
      rows,
      zone,
      worldStart,
      opsNow,
      namespace,
      visitId: testId("visit-kisses"),
      prior: { epoch: core.epoch.data, state: core.state.data, counters: core.counters.data, rules: core.rules.data, bundle: core.bundle.data },
    });
    for (const id of ["epoch", "state", "counters", "rules", "bundle"] as const) tx.update(paths.core(UID, id), { ...docs[id], updatedAt: tsFromMs(opsNow) });
  });
  const evidence = await evidenceOf(rig.store, UID);
  const memories = (await listTenantRows(rig.store, UID)).filter((r) => r.path.includes("/memories/")).map((r) => r.data as unknown as Memory);
  return { rig, rows, worldStart, friday: localDate(worldStart, zone), evidence, memories };
}

describe("the Kisses persona", () => {
  it("is registered, authored, and carries the demo profile", () => {
    expect(KISSES.id).toBe(KISSES_FIXTURE_ID);
    expect(FIXTURES.get(KISSES_FIXTURE_ID)).toBe(KISSES);
    expect(KISSES.origin).toBe("authored");
    expect(KISSES.windowDays).toBe(21);
    expect(KISSES.demo?.displayName).toBe("Jeffrey Kisses");
    expect(KISSES.demo?.google.email).toBe("jeffrey@kisses.example");
    expect(KISSES.demo?.bank.accounts.map((a) => a.accountId)).toEqual(["sim-acct-checking-0001", "sim-acct-savings-0002", "sim-acct-launch-0003"]);
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
  });

  it("loads: the real loader raises no SeedLoadError, and the clone starts on a Friday at 08:40", async () => {
    let loaded;
    try {
      loaded = await clone(ZONE);
    } catch (error) {
      if (error instanceof SeedLoadError) throw new Error(`SeedLoadError ${error.check} on ${error.lineId}`);
      throw error;
    }
    expect(weekdayOf(loaded.friday)).toBe(5);
    expect(localMinute(loaded.worldStart, ZONE)).toBe(8 * 60 + 40);
    expect(loaded.evidence.length).toBeGreaterThan(0);
  });

  it("the hero offer is eligible and mostly on the clone's Friday, in every seed zone", async () => {
    for (const zone of SEED_ZONES) {
      const c = await clone(zone);
      const hero = heroSources(c.evidence, c.rows.window, zone);
      expect(c.rows.window, zone).toEqual({ from: addDays(c.friday, -21), to: addDays(c.friday, -1) });
      expect(hero.coveredDates, zone).toBe(21);
      expect(hero.purchases.map((p) => p.cents).sort((a, b) => a - b), zone).toEqual([900, 2300, 2640, 2875, 3150, 3315, 3420]);
      expect(hero.totalCents, zone).toBe(18_600);
      expect(hero.lateCount, zone).toBe(5);
      expect(hero.lateCents, zone).toBe(15_400);

      const offer = await heroOffer({ uid: UID, deps: c.rig.deps, schedule: c.rig.sched.schedule }, 0);
      expect(offer, zone).not.toBeNull();
      expect(offer!.pattern, zone).toMatchObject({ status: "eligible", mostly: true, associationUnit: "night", totalCents: 18_600, orderCount: 7, lateCents: 15_400, lateOrderCount: 5, coveredDates: 21 });
      expect(offer!.line, zone).toContain("$186");
    }
  }, 120_000);

  it("holds one identity.name item for self, resting on a turn", async () => {
    const items = turns.flatMap((t) => t.extract.filter((i) => i.predicate === "identity.name").map((i) => ({ turn: t, item: i })));
    expect(items).toHaveLength(1);
    const { turn, item } = items[0]!;
    expect(item.subject).toBe("self");
    expect(item.value).toEqual({ kind: "text", text: "Jeffrey Kisses" });
    for (const s of item.spans) expect(turn.text).toContain(s.quote);
    const { memories } = await clone(ZONE);
    const names = memories.filter((m) => m.predicate === "identity.name");
    expect(names).toHaveLength(1);
    expect(names[0]).toMatchObject({ sourceClass: "U", status: "active" });
  });

  it("holds exactly one allergy item, stated in Jeffrey's own words", async () => {
    const items = turns.flatMap((t) => t.extract.filter((i) => i.args.label === "allergy" || /allerg/i.test(JSON.stringify(i.value))).map((i) => ({ turn: t, item: i })));
    expect(items).toHaveLength(1);
    const { turn, item } = items[0]!;
    expect(item.predicate).not.toBe("allergy");
    expect(turn.text).toMatch(/allergic to peanuts/);
    expect(item.spans.map((s) => s.quote)).toEqual(["I'm allergic to peanuts"]);
    for (const s of item.spans) expect(turn.text).toContain(s.quote);
    // Said in one turn only: no other turn or mail line speaks of an allergy.
    expect(turns.filter((t) => /allerg/i.test(t.text))).toHaveLength(1);
    expect(mail.filter((m) => /allerg/i.test(`${m.subject} ${m.body}`))).toHaveLength(0);
    const { memories } = await clone(ZONE);
    const allergy = memories.filter((m) => m.value.kind === "text" && /allergic to peanuts/.test(m.value.text));
    expect(allergy).toHaveLength(1);
    expect(allergy[0]).toMatchObject({ sourceClass: "U", status: "active" });
  });

  it("has mailed senders, strangers, and a stranger who gives an order", () => {
    const sentTo = new Set(mail.filter((m) => m.fromSelf).flatMap((m) => m.to));
    const inbound = mail.filter((m) => !m.fromSelf && !m.bulk);
    const mailed = inbound.filter((m) => sentTo.has(m.from.address));
    const strangers = inbound.filter((m) => !sentTo.has(m.from.address));
    expect(new Set(mailed.map((m) => m.from.name))).toEqual(new Set(["Mission Control", "Rosalind Kisses", "Tobias Ambrey"]));
    expect(strangers.length).toBeGreaterThanOrEqual(1);
    expect(mail.filter((m) => m.from.name === "Mission Control" && !m.fromSelf)).toHaveLength(6);
    const orders = strangers.filter((m) => (m.claims?.directiveCount ?? 0) > 0);
    expect(orders.length).toBeGreaterThanOrEqual(1);
    expect(orders.map((m) => m.id).sort()).toEqual(["mail-gardens-order", "mail-prize-order"]);
    expect(orders.find((m) => m.id === "mail-prize-order")?.dmarc).toBe("fail");
    // Bulk is always a stranger, with nothing claimed.
    for (const m of mail.filter((x) => x.bulk)) expect(m.claims).toEqual({});
  });

  it("keeps every amount at most BANK_CENTS_MAX, and every sent line to a mailed address", () => {
    expect(bank).toHaveLength(35);
    for (const b of bank) {
      expect(Number.isInteger(b.amountCents), b.id).toBe(true);
      expect(Math.abs(b.amountCents), b.id).toBeLessThanOrEqual(BANK_CENTS_MAX);
    }
    expect(Math.max(...bank.map((b) => Math.abs(b.amountCents)))).toBe(4_125_000_000_000);
    for (const m of mail.filter((x) => x.fromSelf)) {
      expect(m.from.address).toBe("jeffrey@kisses.example");
      expect(["desk@mission-control.example", "rosalind@kisses-family.example", "tobias@ambrey-post.example"]).toContain(m.to[0]);
    }
  });

  it("has a rocket-fuel row in the last days of the window, and an event on the clone's Friday", async () => {
    const fuel = bank.filter((b) => b.merchant === "Altivane Rocket Fuel Depot");
    expect(fuel.filter((b) => b.at.day >= -7 && b.at.day <= -1).length).toBeGreaterThanOrEqual(1);
    expect(fuel.filter((b) => b.at.day === 0)).toHaveLength(1);
    expect(calendar.filter((e) => e.revisions.some((r) => r.start.day === 0 && r.at.day < 0)).length).toBeGreaterThanOrEqual(3);
    const { evidence, friday } = await clone(ZONE);
    const today = evidence.filter((e) => {
      const o = (e.data as Evidence).observation;
      return o.kind === "calendar" && e.data.isCurrentProvider && localDate(Date.parse(o.start), ZONE) === friday;
    });
    expect(today).toHaveLength(3);
  });
});
