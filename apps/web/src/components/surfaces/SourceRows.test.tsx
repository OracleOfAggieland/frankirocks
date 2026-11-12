import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROWS_BOX, type SourceRow, SourceRows, totalOf } from "./SourceRows";

const AMOUNTS = ["$30", "$28", "$34", "$34", "$24", "$36"];
const ROWS: SourceRow[] = AMOUNTS.map((amount, i) => ({ id: `r${i}`, when: `Oct ${2 + i * 4}`, what: "Takeout", amount }));
const html = (rows: SourceRow[] = ROWS) => renderToStaticMarkup(<SourceRows id="c1-rows-bank" label="Bank · 6 purchases" rows={rows} />);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

describe("SourceRows", () => {
  it("is a real table in mono with a caption for screen readers", () => {
    const out = html();
    expect(out).toMatch(/^<div id="c1-rows-bank" data-source-rows=""/);
    expect(out).toMatch(/<table class="[^"]*font-mono/);
    expect(out).toContain('<caption class="sr-only">Rows behind this number: Bank · 6 purchases</caption>');
  });

  it("caps its height and scrolls inside the card, reachable by keyboard, with the header held at the top", () => {
    const out = html();
    const box = /^<div[^>]*>/.exec(out)?.[0] ?? "";
    expect(box).toContain('role="region"');
    expect(box).toContain('aria-label="Rows behind this number: Bank · 6 purchases"');
    expect(box).toContain('tabindex="0"');
    for (const c of ["max-h-40", "lg:max-h-72", "overflow-y-auto", "focus-visible:outline-2"]) expect(ROWS_BOX.split(" ")).toContain(c);
    expect(box).toContain(`class="${ROWS_BOX}"`);
    const heads = [...out.matchAll(/<th scope="col" class="([^"]*)"/g)].map((m) => m[1].split(" "));
    expect(heads).toHaveLength(3);
    for (const h of heads) expect(h).toEqual(expect.arrayContaining(["sticky", "top-0", "bg-night-0"]));
  });

  it("is headed When, What, Amount, in that order, as column headers", () => {
    const heads = [...html().matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(["When", "What", "Amount"]);
  });

  it("shows every row, in order, then a total row", () => {
    const out = html();
    const ids = [...out.matchAll(/data-row="([^"]*)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["r0", "r1", "r2", "r3", "r4", "r5", "total"]);
    expect(out).toMatch(/<tfoot><tr data-row="total"[^>]*><th scope="row" colSpan="2"[^>]*>Total<\/th><td[^>]*>\$186<\/td>/);
  });

  it("rows materialize one after another on the stagger", () => {
    const out = html();
    for (let i = 0; i < ROWS.length; i++) expect(out).toContain(`style="--row:${i}"`);
    expect(out).toContain(`style="--row:${ROWS.length}"`);
    expect(out.match(/class="franki-row/g)).toHaveLength(ROWS.length + 1);
  });

  it("has no total row when an amount is not a plain figure", () => {
    const out = html([...ROWS, { id: "x", when: "Oct 30", what: "Refund", amount: "about $5" }]);
    expect(out).not.toContain("<tfoot");
    expect(out).toContain("about $5");
  });

  it("renders nothing with no rows", () => {
    expect(html([])).toBe("");
  });
});

describe("totalOf", () => {
  it("adds the hero's rows to $186", () => {
    expect(totalOf(ROWS)).toBe("$186");
  });

  it("keeps the rows' prefix, grouping and decimals", () => {
    expect(totalOf([{ amount: "$1,200.50" }, { amount: "$0.5" }, { amount: "$99" }])).toBe("$1,300.00");
    expect(totalOf([{ amount: "-$5" }, { amount: "$3" }])).toBe("-$2");
    expect(totalOf([{ amount: "12" }, { amount: "30" }])).toBe("42");
  });

  it("refuses mixed prefixes, words, suffixes and broken grouping", () => {
    expect(totalOf([])).toBeNull();
    expect(totalOf([{ amount: "$5" }, { amount: "€5" }])).toBeNull();
    expect(totalOf([{ amount: "5 dollars" }])).toBeNull();
    expect(totalOf([{ amount: "$1,20" }])).toBeNull();
    expect(totalOf([{ amount: "" }])).toBeNull();
  });

  it("equals the true sum, written the same way, for any list of dollar amounts", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -5_000_000, max: 5_000_000 }), { minLength: 1, maxLength: 12 }), (cents) => {
        const rows = cents.map((c) => ({ amount: usd.format(c / 100) }));
        const sum = cents.reduce((a, b) => a + b, 0);
        expect(totalOf(rows)).toBe(usd.format(sum / 100));
      }),
    );
  });
});
