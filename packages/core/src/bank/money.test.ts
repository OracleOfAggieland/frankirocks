// Brief 046 part C: the pure money read. The group table, each period, what counts, the split and the lines.
import { describe, expect, it } from "vitest";
import {
  MONEY_GROUPS,
  MONEY_GROUP_TABLE,
  MONEY_LINES,
  MONEY_NOTE_ROWS_MAX,
  MONEY_PERIODS,
  PFC_PRIMARIES,
  type MoneyRow,
  codeKind,
  dollars,
  freshnessLine,
  groupMatches,
  groupOf,
  moneyAnswer,
  moneyPeriod,
  partLine,
  primaryOf,
} from "./money";

// Friday 2026-11-13, 15:00 in New York (20:00 UTC).
const NOW = Date.UTC(2026, 10, 13, 20);
const ZONE = "America/New_York";

let n = 0;
function row(over: Partial<MoneyRow> = {}): MoneyRow {
  n++;
  const eid = `e${String(n).padStart(42, "0")}`;
  return { eid, rootKey: `r${eid.slice(1)}`, title: "Corner Cafe", merchantKey: "m-cafe", amountCents: 1000, currency: "USD", pending: false, code: "FOOD_AND_DRINK_COFFEE", day: "2026-11-10", ...over };
}
const ask = (over: Partial<{ period: (typeof MONEY_PERIODS)[number]; group: (typeof MONEY_GROUPS)[number] | null; merchant: string | null }> = {}) => ({
  period: "this_month" as const,
  group: null,
  merchant: null,
  ...over,
});

describe("the group table", () => {
  it("names every primary of Plaid's taxonomy once", () => {
    expect(Object.keys(MONEY_GROUP_TABLE).sort()).toEqual([...PFC_PRIMARIES].sort());
  });

  it.each([
    ["FOOD_AND_DRINK_GROCERIES", "groceries"],
    ["FOOD_AND_DRINK_RESTAURANT", "restaurants"],
    ["FOOD_AND_DRINK_COFFEE", "restaurants"],
    ["FOOD_AND_DRINK_FAST_FOOD", "fastFood"],
    ["FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR", "otherFoodAndDrink"],
    ["FOOD_AND_DRINK_VENDING_MACHINES", "otherFoodAndDrink"],
    ["TRANSPORTATION_GAS", "transportation"],
    ["GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", "shopping"],
    ["ENTERTAINMENT_TV_AND_MOVIES", "entertainment"],
    ["TRAVEL_FLIGHTS", "travel"],
    ["RENT_AND_UTILITIES_RENT", "billsAndUtilities"],
    ["MEDICAL_DENTAL_CARE", "medical"],
    ["PERSONAL_CARE_HAIR_AND_BEAUTY", "personalCare"],
    ["HOME_IMPROVEMENT_HARDWARE", "home"],
    ["GENERAL_SERVICES_INSURANCE", "services"],
    ["BANK_FEES_ATM_FEES", "fees"],
    ["LOAN_PAYMENTS_CAR_PAYMENT", "loanPayments"],
    ["GOVERNMENT_AND_NON_PROFIT_DONATIONS", "giving"],
    ["GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT", "government"],
    ["OTHER_OTHER", "other"],
    ["SOMETHING_NEW_FROM_PLAID", "other"],
    ["lowercase_code", "uncategorized"],
  ] as const)("%s is %s", (code, group) => {
    expect(groupOf(code)).toBe(group);
  });

  it("no code is uncategorized; primaries with underscores are matched whole", () => {
    expect(groupOf(null)).toBe("uncategorized");
    expect(primaryOf("TRANSFER_IN_ACCOUNT_TRANSFER")).toBe("TRANSFER_IN");
    expect(primaryOf("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBe("LOAN_PAYMENTS");
    expect(primaryOf("GENERAL_SERVICES_AUTOMOTIVE")).toBe("GENERAL_SERVICES");
    expect(primaryOf("GENERAL_MERCHANDISE_SUPERSTORES")).toBe("GENERAL_MERCHANDISE");
  });

  it.each([
    ["TRANSFER_IN_DEPOSIT", "transfer"],
    ["TRANSFER_OUT_SAVINGS", "transfer"],
    ["LOAN_DISBURSEMENTS_STUDENT", "transfer"],
    ["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "cardPayment"],
    ["LOAN_PAYMENTS_MORTGAGE_PAYMENT", "ordinary"],
    ["INCOME_SALARY", "income"],
    ["INCOME_WAGES", "income"],
    ["FOOD_AND_DRINK_GROCERIES", "ordinary"],
  ] as const)("%s is %s", (code, kind) => {
    expect(codeKind(code)).toBe(kind);
  });

  it("foodAndDrink covers the four food groups and nothing else", () => {
    expect(["groceries", "restaurants", "fastFood", "otherFoodAndDrink"].every((g) => groupMatches("foodAndDrink", g as never))).toBe(true);
    expect(groupMatches("foodAndDrink", "travel")).toBe(false);
    expect(groupMatches(null, "travel")).toBe(true);
  });
});

describe("periods, from the ops clock in the owner's zone", () => {
  it.each([
    ["this_week", "2026-11-09", "2026-11-13"],
    ["last_week", "2026-11-02", "2026-11-08"],
    ["this_month", "2026-11-01", "2026-11-13"],
    ["last_month", "2026-10-01", "2026-10-31"],
    ["last_7_days", "2026-11-07", "2026-11-13"],
    ["last_30_days", "2026-10-15", "2026-11-13"],
    ["last_90_days", "2026-08-16", "2026-11-13"],
  ] as const)("%s runs %s to %s", (period, from, to) => {
    expect(moneyPeriod(period, NOW, ZONE)).toEqual({ from, to });
  });

  it("uses the owner's zone: 02:00 UTC on Nov 1 is still October in New York", () => {
    expect(moneyPeriod("this_month", Date.UTC(2026, 10, 1, 2), ZONE)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(moneyPeriod("last_month", Date.UTC(2026, 0, 10, 12), "UTC")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    // A Sunday is the last day of its week.
    expect(moneyPeriod("this_week", Date.UTC(2026, 10, 15, 12), "UTC")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });
});

describe("the answer", () => {
  it("totals spending in cents, leaves out transfers, card payments and income, and reports money back on its own", () => {
    const spend = [row({ amountCents: 1234 }), row({ amountCents: 1, code: null, title: "Unknown Shop", merchantKey: null })];
    const back = row({ amountCents: -500, code: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", title: "Online Store", merchantKey: "m-store" });
    const skipped = [
      row({ amountCents: 90000, code: "TRANSFER_OUT_SAVINGS" }),
      row({ amountCents: -90000, code: "TRANSFER_IN_ACCOUNT_TRANSFER" }),
      row({ amountCents: 50000, code: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
      row({ amountCents: -300000, code: "INCOME_SALARY" }),
    ];
    const f = moneyAnswer([...spend, back, ...skipped], ask(), NOW, ZONE, "what did I spend");
    expect(f.kind).toBe("answered");
    if (f.kind !== "answered") return;
    const [p] = f.parts;
    expect(p!.spent).toEqual({ cents: 1235, count: 2, eids: [spend[0]!.eid, spend[1]!.eid].sort() });
    expect(p!.moneyBack).toEqual({ cents: 500, count: 1, eids: [back.eid] });
    expect(p!.cited.map((c) => c.eid).sort()).toEqual([...spend, back].map((r) => r.eid).sort());
    expect(partLine(p!)).toBe("From November 1 to November 13: $12.35 spent across 2 purchases. Top: Corner Cafe $12.34; Unknown Shop $0.01. Money back: $5.00 across 1 refund or credit.");
  });

  it("leaves out pending rows, other currencies and rows with no date, and counts each", () => {
    const rows = [row(), row({ pending: true, amountCents: 999 }), row({ currency: "CAD", amountCents: 777 }), row({ day: null, amountCents: 555 })];
    const f = moneyAnswer(rows, ask(), NOW, ZONE, "spending");
    if (f.kind !== "answered") throw new Error(f.kind);
    const p = f.parts[0]!;
    expect(p.spent.cents).toBe(1000);
    expect([p.pending.length, p.otherCurrency.length, p.unknownTime.length]).toEqual([1, 1, 1]);
    expect(partLine(p)).toContain("Not counted: 1 pending charge, 1 charge in another currency, 1 charge with no date.");
  });

  it("filters by group and by the merchant's words, only when the owner said them", () => {
    const rows = [row({ code: "FOOD_AND_DRINK_GROCERIES", title: "Trader Joe's", merchantKey: "m-tj", amountCents: 4000 }), row({ code: "TRAVEL_FLIGHTS", title: "Air Line", merchantKey: "m-air", amountCents: 30000 })];
    const g = moneyAnswer(rows, ask({ group: "foodAndDrink" }), NOW, ZONE, "food spending");
    expect(g.kind === "answered" && g.parts[0]!.spent.cents).toBe(4000);
    const m = moneyAnswer(rows, ask({ merchant: "Trader Joe's" }), NOW, ZONE, "how much at trader joe's this month");
    expect(m.kind === "answered" && m.parts[0]!.spent.cents).toBe(4000);
    // The model named a merchant the owner never said: no total.
    expect(moneyAnswer(rows, ask({ merchant: "Air Line" }), NOW, ZONE, "what did I spend this month").kind).toBe("unclear");
  });

  it("cites nothing outside the period", () => {
    const f = moneyAnswer([row({ day: "2026-10-31" }), row({ day: "2026-11-14" })], ask(), NOW, ZONE, "spend");
    expect(f.kind === "answered" && f.parts[0]!.cited).toEqual([]);
    expect(f.kind === "answered" && partLine(f.parts[0]!)).toBe("From November 1 to November 13: no spending found.");
  });

  it("splits a period with more rows than a note can cite into consecutive weeks, each within the cap", () => {
    const days = ["2026-10-20", "2026-10-28", "2026-11-05", "2026-11-12"];
    const rows = days.flatMap((d) => Array.from({ length: 60 }, () => row({ day: d, amountCents: 100 })));
    const f = moneyAnswer(rows, ask({ period: "last_30_days" }), NOW, ZONE, "spending");
    if (f.kind !== "answered") throw new Error(f.kind);
    expect(f.parts.length).toBeGreaterThan(1);
    expect(f.parts.length).toBeLessThanOrEqual(4);
    expect(f.parts.every((p) => p.cited.length <= MONEY_NOTE_ROWS_MAX)).toBe(true);
    expect(f.parts.reduce((a, p) => a + p.spent.cents, 0)).toBe(24000);
    expect(f.parts[0]!.from).toBe("2026-10-15");
    expect(f.parts[f.parts.length - 1]!.to).toBe("2026-11-13");
    for (let i = 1; i < f.parts.length; i++) expect(f.parts[i]!.from > f.parts[i - 1]!.to).toBe(true);
  });

  it("asks for a narrower question, with no total, when one week is too big to cite", () => {
    const rows = Array.from({ length: MONEY_NOTE_ROWS_MAX + 1 }, () => row({ day: "2026-11-10" }));
    expect(moneyAnswer(rows, ask(), NOW, ZONE, "spending")).toEqual({ kind: "narrow", from: "2026-11-01", to: "2026-11-13" });
    expect(MONEY_LINES.narrow).not.toMatch(/\d/);
  });

  it("asks for a narrower question when the weeks would need more than four parts", () => {
    // 100 rows in each of five separate weeks: five parts.
    const many = ["2026-08-17", "2026-09-07", "2026-09-28", "2026-10-19", "2026-11-09"].flatMap((d) => Array.from({ length: 100 }, () => row({ day: d })));
    expect(moneyAnswer(many, ask({ period: "last_90_days" }), NOW, ZONE, "spending").kind).toBe("narrow");
  });
});

describe("lines", () => {
  it("formats cents exactly", () => {
    expect([dollars(0), dollars(5), dollars(123456789), dollars(-1050)]).toEqual(["$0.00", "$0.05", "$1,234,567.89", "-$10.50"]);
  });

  it("says how fresh the bank read is", () => {
    expect(freshnessLine(null, NOW)).toBe("The bank hasn't been read yet.");
    expect(freshnessLine(NOW - 30_000, NOW)).toBe("The bank was read just now.");
    expect(freshnessLine(NOW - 3 * 3_600_000, NOW)).toBe("The bank was last read 3 hours ago.");
  });

  it("lines with no total hold no digit, no advice and no cause word", () => {
    for (const line of Object.values(MONEY_LINES)) {
      expect(line).not.toMatch(/\d/);
      expect(line).not.toMatch(/\b(should|because|caused|led to)\b/i);
    }
  });
});
