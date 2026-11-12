/**
 * Generators for the money-pattern properties (brief 022). They build bank, receipt and calendar rows around a
 * window in a few zones (US zones cross the Nov 1 2026 DST change), with coverage gaps as whole local dates, noise
 * rows (pending, removed, other categories, other currencies, duplicates, refunds, unknown times) and both kinds of
 * purchase time. The oracle helpers here use Intl directly, not the product's civil helpers.
 */
import fc from "fast-check";
import type { Cov } from "../../schema/primitives";
import type { LoopRecord } from "../../schema/records";
import { testId } from "../../testing/samples";
import type { BankObs, BankRow, CalendarObs, MeetingRow, PatternInput, ReceiptRow } from "../types";

export const ZONES = ["America/Chicago", "America/New_York", "UTC", "Asia/Tokyo"] as const;

const fmt = new Map<string, Intl.DateTimeFormat>();
/** Oracle: the local date and minute of an instant, straight from Intl. */
export function oracleLocal(ms: number, zone: string): { date: string; minute: number } {
  let f = fmt.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    fmt.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** Oracle: a civil date `n` days after `date`. */
export function plusDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** Oracle: every date from `from` to `to`, inclusive. */
export function oracleDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 500; d = plusDays(d, 1)) out.push(d);
  return out;
}

export const oracleWeekday = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
};

const wallMs = (date: string, minute: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) + minute * 60_000;
};

const instants = new Map<string, number>();
/**
 * Oracle: an instant at a local minute of a date: start from the wall time read as UTC and correct by the zone's
 * offset until Intl reads back the wall time (a skipped minute lands just after the gap).
 */
export function instantAt(date: string, minute: number, zone: string): number {
  const key = `${date}|${minute}|${zone}`;
  const hit = instants.get(key);
  if (hit !== undefined) return hit;
  const target = wallMs(date, minute);
  let ms = target;
  for (let i = 0; i < 4; i++) {
    const l = oracleLocal(ms, zone);
    const diff = target - wallMs(l.date, l.minute);
    if (diff === 0) break;
    ms += diff;
  }
  instants.set(key, ms);
  return ms;
}

/** Oracle: the first instant of a date in a zone. */
export const midnight = (date: string, zone: string): number => instantAt(date, 0, zone);

const iso = (ms: number) => new Date(ms).toISOString();

export function coverageFor(from: string, to: string, zone: string, gaps: readonly string[], state: Cov["state"] = "complete"): Cov {
  return {
    state,
    from: iso(midnight(from, zone) - 86_400_000),
    to: iso(midnight(plusDays(to, 2), zone)),
    missingRanges: [...new Set(gaps)].slice(0, 32).map((d) => ({ from: iso(midnight(d, zone)), to: iso(midnight(plusDays(d, 1), zone)), reason: "provider" as const })),
    generation: 1,
  };
}

export interface OrderSpec {
  offset: number;
  time: "instant" | "date" | "receipt" | "unknown" | "receiptOffDate";
  minute: number;
  cents: number;
  category: BankObs["category"];
  noise: "none" | "pending" | "removed" | "unposted" | "currency" | "duplicate" | "refund" | "fullRefund";
}

export const orderSpecArb = (span: number): fc.Arbitrary<OrderSpec> =>
  fc.record({
    offset: fc.integer({ min: -2, max: span + 1 }),
    time: fc.constantFrom<OrderSpec["time"]>("instant", "instant", "instant", "date", "receipt", "receipt", "unknown", "receiptOffDate"),
    minute: fc.oneof({ weight: 3, arbitrary: fc.integer({ min: 18 * 60, max: 1439 }) }, { weight: 2, arbitrary: fc.integer({ min: 0, max: 1439 }) }),
    cents: fc.integer({ min: 1, max: 6000 }),
    category: fc.constantFrom<BankObs["category"]>("takeout", "takeout", "takeout", "takeout", "groceries", "restaurant", "other"),
    noise: fc.constantFrom<OrderSpec["noise"]>("none", "none", "none", "none", "none", "none", "pending", "removed", "unposted", "currency", "duplicate", "refund", "fullRefund"),
  });

/** A countable takeout order with a known time, mostly in the evening, sometimes partly refunded. */
export const cleanOrderSpecArb = (span: number): fc.Arbitrary<OrderSpec> =>
  fc.record({
    offset: fc.integer({ min: 0, max: span }),
    time: fc.constantFrom<OrderSpec["time"]>("instant", "instant", "instant", "receipt", "date"),
    minute: fc.oneof({ weight: 5, arbitrary: fc.integer({ min: 18 * 60, max: 1439 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 1439 }) }),
    cents: fc.integer({ min: 100, max: 6000 }),
    category: fc.constant<BankObs["category"]>("takeout"),
    noise: fc.constantFrom<OrderSpec["noise"]>("none", "none", "none", "none", "none", "none", "refund"),
  });

export interface EventSpec {
  offset: number;
  minute: number;
  status: CalendarObs["status"];
  selfResponse: CalendarObs["selfResponse"];
  allDay: boolean;
  transparency: CalendarObs["transparency"];
}

export const eventSpecArb = (span: number): fc.Arbitrary<EventSpec> =>
  fc.record({
    offset: fc.integer({ min: -1, max: span }),
    minute: fc.oneof({ weight: 3, arbitrary: fc.integer({ min: 18 * 60, max: 1439 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 1439 }) }),
    status: fc.constantFrom<CalendarObs["status"]>("confirmed", "confirmed", "confirmed", "tentative", "cancelled"),
    selfResponse: fc.constantFrom<CalendarObs["selfResponse"]>("accepted", "accepted", "accepted", "declined", "needsAction", "tentative", "none"),
    allDay: fc.constantFrom(false, false, false, false, true),
    transparency: fc.constantFrom<CalendarObs["transparency"]>("opaque", "opaque", "opaque", "transparent"),
  });

/** An accepted, confirmed, busy, timed meeting starting in the evening. */
export const cleanEventSpecArb = (span: number): fc.Arbitrary<EventSpec> =>
  fc.record({
    offset: fc.integer({ min: 0, max: span }),
    minute: fc.integer({ min: 18 * 60, max: 1439 }),
    status: fc.constant<CalendarObs["status"]>("confirmed"),
    selfResponse: fc.constant<CalendarObs["selfResponse"]>("accepted"),
    allDay: fc.constant(false),
    transparency: fc.constant<CalendarObs["transparency"]>("opaque"),
  });

export interface BuiltRows {
  purchases: BankRow[];
  receipts: ReceiptRow[];
}

let serial = 0;
const nextId = (p: string) => testId(`${p}${serial++}`);

/** Builds bank rows (and receipts) for order specs around a window start date. */
export function buildOrders(specs: readonly OrderSpec[], from: string, zone: string, currency: string, idPrefix = "b"): BuiltRows {
  const purchases: BankRow[] = [];
  const receipts: ReceiptRow[] = [];
  specs.forEach((s, i) => {
    const date = plusDays(from, s.offset);
    const at = instantAt(date, s.minute, zone);
    const id = nextId(`${idPrefix}${i}_`);
    const purchaseAt: BankObs["purchaseAt"] =
      s.time === "instant"
        ? { instant: iso(at), civilDate: null, zone, basis: "providerAuthorized", precision: "instant" }
        : s.time === "unknown"
          ? { instant: null, civilDate: null, zone: null, basis: "unknown", precision: "unknown" }
          : { instant: null, civilDate: date, zone, basis: "providerDate", precision: "day" };
    const bank: BankObs = {
      kind: "bank",
      providerKey: s.noise === "duplicate" ? testId(`dup${idPrefix}`) : testId(`pk_${id.slice(1, 12)}`),
      pending: s.noise === "pending",
      removed: s.noise === "removed",
      amountCents: s.cents,
      currency: s.noise === "currency" ? (currency === "USD" ? "EUR" : "USD") : currency,
      pendingOfId: null,
      refundOfId: null,
      merchantKey: null,
      category: s.category,
      purchaseAt,
      postedAt: s.noise === "unposted" ? null : iso(at + 2 * 86_400_000),
      accountKey: testId("acct"),
    };
    purchases.push({ id, rootKey: testId(`rk_${id.slice(1, 14)}`), bank });
    if (s.time === "receipt" || s.time === "receiptOffDate") {
      const orderAt = s.time === "receipt" ? at : instantAt(plusDays(date, 1), s.minute, zone);
      const rid = nextId(`rc${i}_`);
      receipts.push({
        id: rid,
        rootKey: testId(`rk_${rid.slice(1, 14)}`),
        receipt: { kind: "receipt", orderKey: null, bankEvidenceId: id, amountCents: s.cents, currency, orderAt: iso(orderAt), merchantKey: null, match: "exact" },
      });
    }
    if (s.noise === "refund" || s.noise === "fullRefund") {
      const back = s.noise === "fullRefund" ? s.cents : Math.max(1, Math.floor(s.cents / 3));
      const fid = nextId(`rf${i}_`);
      purchases.push({
        id: fid,
        rootKey: testId(`rk_${fid.slice(1, 14)}`),
        bank: { ...bank, providerKey: testId(`pk_${fid.slice(1, 12)}`), pending: false, removed: false, currency, amountCents: -back, refundOfId: id, postedAt: iso(at + 3 * 86_400_000) },
      });
    }
  });
  return { purchases, receipts };
}

export function buildEvents(specs: readonly EventSpec[], from: string, zone: string): MeetingRow[] {
  return specs.map((s, i) => {
    const date = plusDays(from, s.offset);
    const start = instantAt(date, s.minute, zone);
    const id = nextId(`e${i}_`);
    return {
      id,
      rootKey: testId(`rk_${id.slice(1, 14)}`),
      calendar: {
        kind: "calendar",
        providerKey: testId(`ek_${id.slice(1, 12)}`),
        calendarKey: testId("cal"),
        seriesKey: null,
        originalStart: null,
        start: iso(start),
        end: iso(start + 3_600_000),
        zone,
        allDay: s.allDay,
        status: s.status,
        selfResponse: s.selfResponse,
        transparency: s.transparency,
        organizerSelf: false,
        creatorSelf: false,
        organizerId: null,
        attendeeIds: [],
        scheduleRev: 0,
      },
    };
  });
}

export interface PatternCase {
  input: PatternInput;
  /** Dates of the window the arbitrary left uncovered in bank or calendar coverage. */
  uncovered: Set<string>;
  windowDates: string[];
}

export const patternCaseArb: fc.Arbitrary<PatternCase> = fc
  .record({
    zone: fc.constantFrom(...ZONES),
    startOffset: fc.integer({ min: 0, max: 45 }),
    span: fc.oneof({ weight: 6, arbitrary: fc.constant(20) }, { weight: 1, arbitrary: fc.integer({ min: 15, max: 25 }) }),
    unknownCov: fc.nat(15).map((x) => x === 0),
  })
  .chain(({ zone, startOffset, span, unknownCov }) => {
    const from = plusDays("2026-10-01", startOffset);
    const to = plusDays(from, span);
    return fc
      .record({
        orders: fc.oneof(fc.array(orderSpecArb(span), { minLength: 0, maxLength: 16 }), fc.array(cleanOrderSpecArb(span), { minLength: 4, maxLength: 14 }), fc.tuple(fc.array(cleanOrderSpecArb(span), { minLength: 5, maxLength: 12 }), fc.array(orderSpecArb(span), { maxLength: 4 })).map(([a, b]) => [...a, ...b])),
        events: fc.oneof(
          fc.array(eventSpecArb(span), { minLength: 0, maxLength: 16 }),
          fc.tuple(fc.array(cleanEventSpecArb(span), { minLength: 6, maxLength: 24 }), fc.array(eventSpecArb(span), { maxLength: 4 })).map(([a, b]) => [...a, ...b]),
          // Most dates have an evening meeting: the hero's shape.
          fc.tuple(fc.subarray(Array.from({ length: span + 1 }, (_, i) => i), { minLength: Math.ceil(span * 0.6) }), fc.integer({ min: 18 * 60, max: 1439 }), fc.array(eventSpecArb(span), { maxLength: 3 })).map(([days, minute, noise]) => [
            ...days.map((offset) => ({ offset, minute, status: "confirmed" as const, selfResponse: "accepted" as const, allDay: false, transparency: "opaque" as const })),
            ...noise,
          ]),
        ),
        bankGaps: fc.uniqueArray(fc.integer({ min: 0, max: span }), { maxLength: 9 }).chain((g) => fc.constantFrom(g, g.slice(0, 2), g.slice(0, 0))),
        calGaps: fc.uniqueArray(fc.integer({ min: 0, max: span }), { maxLength: 5 }).map((g) => g.slice(0, 3)),
      })
      .map(({ orders, events, bankGaps, calGaps }) => {
        const built = buildOrders(orders, from, zone, "USD");
        const bankGapDates = bankGaps.map((g) => plusDays(from, g));
        const calGapDates = calGaps.map((g) => plusDays(from, g));
        const input: PatternInput = {
          purchases: built.purchases,
          receipts: built.receipts,
          events: buildEvents(events, from, zone),
          bankCoverage: coverageFor(from, to, zone, bankGapDates, unknownCov ? "unknown" : "complete"),
          calendarCoverage: coverageFor(from, to, zone, calGapDates),
          window: { fromCivil: from, toCivil: to, zone, currency: "USD" },
        };
        const windowDates = oracleDates(from, to);
        const uncovered = new Set(unknownCov ? windowDates : [...bankGapDates, ...calGapDates]);
        return { input, uncovered, windowDates };
      });
  });

export interface LoopCase {
  loop: LoopRecord;
  purchases: BankRow[];
  coverage: ReturnType<typeof coverageFor>;
  worldNow: number;
  uncovered: Set<string>;
}

/**
 * A loop with a baseline and a comparison window (equal or not, in length and weekday mix), takeout and other rows
 * in both, coverage gaps, and a world time before or after `checkAt`. The baseline's stored value is the plain sum
 * of its clean takeout rows, or off by a cent.
 */
export const loopCaseArb: fc.Arbitrary<LoopCase> = fc
  .record({
    zone: fc.constantFrom(...ZONES),
    startOffset: fc.integer({ min: 0, max: 30 }),
    baseSpan: fc.oneof({ weight: 5, arbitrary: fc.constant(20) }, { weight: 1, arbitrary: fc.integer({ min: 12, max: 25 }) }),
    gapDays: fc.integer({ min: 0, max: 9 }),
    compDelta: fc.oneof({ weight: 5, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: -3, max: 3 }) }),
    beforeOrders: fc.oneof(fc.array(orderSpecArb(20), { maxLength: 12 }), fc.array(cleanOrderSpecArb(20), { minLength: 3, maxLength: 12 })),
    afterOrders: fc.oneof(fc.array(orderSpecArb(20), { maxLength: 12 }), fc.array(cleanOrderSpecArb(20), { maxLength: 6 })),
    gaps: fc.uniqueArray(fc.integer({ min: 0, max: 60 }), { maxLength: 4 }),
    noGaps: fc.boolean(),
    late: fc.boolean(),
    baselineOff: fc.nat(8).map((x) => x === 0),
    state: fc.constantFrom<LoopRecord["state"]>("waiting", "waiting", "waiting", "incomplete", "cancelled"),
  })
  .map((r) => {
    const bFrom = plusDays("2026-10-01", r.startOffset);
    const bTo = plusDays(bFrom, r.baseSpan);
    const cFrom = plusDays(bTo, 1 + r.gapDays);
    const cTo = plusDays(cFrom, Math.max(1, r.baseSpan + r.compDelta));
    const clean = (s: OrderSpec): OrderSpec => ({ ...s, time: s.time === "unknown" ? "instant" : s.time });
    const before = buildOrders(r.beforeOrders.map(clean), bFrom, r.zone, "USD", "lb");
    const after = buildOrders(r.afterOrders.map(clean), cFrom, r.zone, "USD", "la");
    const gapDates = r.noGaps ? [] : r.gaps.map((g) => plusDays(bFrom, g));
    const coverage = coverageFor(bFrom, cTo, r.zone, gapDates);
    const bDates = oracleDates(bFrom, bTo);
    const bSet = new Set(bDates);
    // The plain sum of the baseline's countable takeout rows, the way the spec counts them.
    const counted = before.purchases.filter((p) => p.bank.refundOfId === null && p.bank.category === "takeout" && !p.bank.pending && !p.bank.removed && p.bank.postedAt !== null && p.bank.currency === "USD");
    const dupSeen = new Set<string>();
    let value = 0;
    for (const p of counted) {
      const date = p.bank.purchaseAt.civilDate ?? (p.bank.purchaseAt.instant === null ? null : oracleLocal(Date.parse(p.bank.purchaseAt.instant), r.zone).date);
      if (date === null || !bSet.has(date) || dupSeen.has(p.bank.providerKey)) continue;
      dupSeen.add(p.bank.providerKey);
      const refunds = before.purchases.filter((q) => q.bank.refundOfId === p.id).reduce((a, q) => a + q.bank.amountCents, 0);
      if (p.bank.amountCents + refunds > 0) value += p.bank.amountCents + refunds;
    }
    const checkAt = midnight(plusDays(cTo, 1), r.zone);
    const win = (from: string, to: string, valueCents: number | null, ids: string[]) => ({
      fromCivil: from,
      toCivil: to,
      zone: r.zone,
      currency: "USD",
      coverage,
      purchaseIds: ids,
      valueCents,
      weekdayCounts: oracleDates(from, to).reduce((acc, d) => {
        acc[oracleWeekday(d)]! += 1;
        return acc;
      }, [0, 0, 0, 0, 0, 0, 0]),
    });
    const loop: LoopRecord = {
      acceptedActionId: testId("action"),
      metric: "takeoutSpend",
      baseline: win(bFrom, bTo, value + (r.baselineOff ? 1 : 0), before.purchases.map((p) => p.id).slice(0, 128)),
      comparison: win(cFrom, cTo, null, []),
      checkAt: iso(checkAt),
      predicateVersion: "takeout_late_meeting_v1",
      state: r.state,
      appraisalRef: null,
    };
    return { loop, purchases: [...before.purchases, ...after.purchases], coverage, worldNow: checkAt + (r.late ? 3_600_000 : -3_600_000), uncovered: new Set(gapDates) };
  });
