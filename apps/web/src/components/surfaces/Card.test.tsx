import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio } from "../../ui/contrast";
import { COLOR, DUR, SPRING } from "../../ui/motion";
import type { CardProps } from "../../ui/surface-props";
import { Card, KindGlyph, nextOpenSource, rowsElementId, sourceTagPlan, tagTapHandler } from "./Card";
import type { SourceRow } from "./SourceRows";

const cardsCss = readFileSync(join(import.meta.dirname, "cards.css"), "utf8");
const ROWS: SourceRow[] = ["$30", "$28", "$34", "$34", "$24", "$36"].map((amount, i) => ({ id: `r${i}`, when: `Oct ${2 + i}`, what: "Takeout", amount }));
const noop = () => {};
const sources = [{ id: "bank", label: "Bank · 6 purchases" }];
const SOURCE: CardProps = {
  kind: "source", id: "c1", title: "Takeout nights", sources, onOpenSource: noop,
  body: "Mostly on nights with meetings after 6.", figures: [{ label: "This month", value: "$115 less", sourceId: "bank" }],
};
const APPROVAL: CardProps = { kind: "approval", id: "c2", title: "Book a table", sources: [], onOpenSource: noop, effect: "I'll book a table for two at 7 PM.", onYes: noop, onNotNow: noop };
const FOOD: CardProps = {
  kind: "food", id: "c3", title: "Dinner pick", sources: [], onOpenSource: noop, choice: "Pad thai, no peanuts", ingredients: ["rice noodles", "egg"],
  checkedFor: [{ person: "Sam", rules: [{ id: "r1", person: "Sam", text: "No peanuts" }] }],
};
const ASK: CardProps = { kind: "ask", id: "c4", title: "Which one?", sources: [], onOpenSource: noop, question: "Forget the dentist or the doctor?", options: [{ id: "a", label: "Dentist" }, { id: "b", label: "Doctor" }], onAnswer: noop };
const READ: CardProps = { kind: "read", id: "c5", title: "Your list", sources: [], onOpenSource: noop, lines: ["Milk", "Eggs"] };
const html = (p: CardProps) => renderToStaticMarkup(<Card {...p} />);

/** Calls the onClick of the React element in the tree whose props match. */
function click(el: unknown, match: (props: Record<string, unknown>) => boolean): boolean {
  if (el === null || typeof el !== "object") return false;
  if (Array.isArray(el)) return el.some((c) => click(c, match));
  const node = el as { type: unknown; props: Record<string, unknown> };
  if (typeof node.type === "function") return click((node.type as (p: unknown) => unknown)(node.props), match);
  if (node.props && match(node.props) && typeof node.props.onClick === "function") {
    (node.props.onClick as () => void)();
    return true;
  }
  return click(node.props?.children, match);
}

describe("Card", () => {
  it.each([SOURCE, APPROVAL, FOOD, ASK, READ])("$kind renders title, content, sources, actions in order", (p) => {
    const out = html(p);
    expect(out).toContain(`data-card="${p.kind}"`);
    const order = ["title", "content", "sources", "actions"].map((s) => out.indexOf(`data-section="${s}"`)).filter((i) => i >= 0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(out.indexOf('data-section="title"')).toBeGreaterThan(-1);
    expect(out).toContain("data-seam");
  });

  it("puts every number in mono with its source tag inline right after it, opening its rows", () => {
    const onOpenSource = vi.fn();
    const out = html(SOURCE);
    expect(out).toMatch(/class="font-mono[^"]*"[^>]*>\$115 less<\/span><button[^>]*data-figure-source="bank"/);
    expect(click(Card({ ...SOURCE, onOpenSource }), (p) => p["data-figure-source"] === "bank")).toBe(true);
    expect(onOpenSource).toHaveBeenCalledWith("bank");
    expect(onOpenSource).toHaveBeenCalledTimes(1);
  });

  it("a source tag is a quiet chip: mono 12 px, ink-dim, ink-dim outline, brass on hover and focus, 44 px target", () => {
    const out = html({ ...SOURCE, sources: [...sources, { id: "cal", label: "Calendar" }] });
    const tags = [...out.matchAll(/<button type="button" data-(?:figure-)?source="[^"]*" class="([^"]*)"><span class="([^"]*)">/g)];
    expect(tags).toHaveLength(2);
    for (const [, button, chip] of tags) {
      for (const k of ["font-mono", "text-xs", "text-ink-dim", "hover:text-brass", "focus-visible:text-brass", "min-h-11", "focus-visible:outline"]) expect(button).toContain(k);
      expect(button).not.toMatch(/(^|\s)(border-brass|bg-brass|text-sm)(\s|$)/);
      for (const k of ["border", "border-ink-dim", "group-hover:border-brass", "group-focus-visible:border-brass"]) expect(chip.split(" ")).toContain(k);
    }
    // The outline meets 3:1 against the Card.
    expect(contrastRatio(COLOR["ink-dim"], COLOR["night-2"])).toBeGreaterThanOrEqual(3);
  });

  it("the sources row lists only sources no figure has cited", () => {
    const p: CardProps = {
      ...SOURCE,
      sources: [{ id: "bank", label: "Bank" }, { id: "cal", label: "Calendar" }, { id: "notes", label: "Notes" }],
      figures: [{ label: "This month", value: "$115 less", sourceId: "bank" }],
    } as CardProps;
    const out = html(p);
    expect(out).toContain('data-figure-source="bank"');
    expect(out).not.toContain('data-source="bank"');
    expect(out).toContain('data-source="cal"');
    expect(out).toContain('data-source="notes"');
    expect(sourceTagPlan(p).row.map((s) => s.id)).toEqual(["cal", "notes"]);
    // Every source cited: no sources row at all.
    expect(html(SOURCE)).not.toContain('data-section="sources"');
  });

  it("shows each source at most once on a Card", () => {
    const sourceArb = fc.constantFrom("a", "b", "c", "d");
    fc.assert(
      fc.property(fc.array(sourceArb, { maxLength: 6 }), fc.array(sourceArb, { maxLength: 6 }), (sourceIds, figureIds) => {
        const p = {
          ...SOURCE,
          sources: sourceIds.map((id) => ({ id, label: `Label ${id}` })),
          figures: figureIds.map((id, i) => ({ label: `F${i}`, value: String(i), sourceId: id })),
        } as CardProps;
        const ids = [...html(p).matchAll(/data-(?:figure-)?source="([^"]*)"/g)].map((m) => m[1]);
        expect(new Set(ids).size).toBe(ids.length);
        // Nothing is dropped: every listed or cited source appears once.
        expect(new Set(ids)).toEqual(new Set([...sourceIds, ...figureIds]));
      }),
    );
  });

  it("approval offers exactly Yes and Not now, neither pre-selected", () => {
    const out = html(APPROVAL);
    expect(out.match(/<button/g)).toHaveLength(2);
    expect(out).toContain(">Yes<");
    expect(out).toContain(">Not now<");
    expect(out).not.toMatch(/autofocus|autoFocus|aria-pressed|checked|aria-selected/i);
    const onYes = vi.fn();
    const onNotNow = vi.fn();
    click(Card({ ...APPROVAL, onYes, onNotNow }), (p) => p["data-action"] === "yes");
    click(Card({ ...APPROVAL, onYes, onNotNow }), (p) => p["data-action"] === "not-now");
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(onNotNow).toHaveBeenCalledTimes(1);
  });

  it("food names every rule per person with a seal, and never says safe", () => {
    const out = html(FOOD);
    expect(out).toContain("Checked for Sam");
    expect(out).toContain("No peanuts");
    expect(out).toContain('aria-label="Locked rule"');
    expect(out).not.toMatch(/\bsafe\b/i);
  });

  it("never offers to remove a hard rule: the rule lines are locked and read-only", () => {
    const out = html(FOOD);
    expect(out).toContain('aria-label="Locked rule"');
    expect(out).not.toMatch(/remove/i);
    expect(out).not.toMatch(/onSwipe|dismiss|draggable/i);
    expect(out).not.toContain("<button");
  });

  it("ask calls onAnswer with the option ID", () => {
    const onAnswer = vi.fn();
    click(Card({ ...(ASK as Extract<CardProps, { kind: "ask" }>), onAnswer }), (p) => p["data-action"] === "answer-b");
    expect(onAnswer).toHaveBeenCalledWith("b");
  });

  it("a read card offers Close only when given onClose, and Close calls it", () => {
    expect(html(READ)).not.toContain('data-section="actions"');
    const onClose = vi.fn();
    const closable: CardProps = { ...(READ as Extract<CardProps, { kind: "read" }>), onClose };
    const out = html(closable);
    expect(out).toMatch(/data-section="actions"[^>]*><button type="button" data-action="close"[^>]*>Close<\/button>/);
    expect(out.indexOf('data-section="content"')).toBeLessThan(out.indexOf('data-action="close"'));
    click(Card(closable), (p) => p["data-action"] === "close");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is glass with the seam at the top and a line glyph for its kind beside the title", () => {
    for (const p of [SOURCE, APPROVAL, FOOD, ASK, READ]) {
      const out = html(p);
      expect(out).toMatch(/^<article data-card="[a-z]+" aria-label="[^"]*" class="franki-card mat-glass /);
      expect(out.indexOf("data-seam")).toBeLessThan(out.indexOf('data-section="title"'));
      const title = /<h2 data-section="title"[^>]*>(.*?)<\/h2>/.exec(out)?.[1] ?? "";
      expect(title).toMatch(new RegExp(`^<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" data-glyph="${p.kind}"`));
      expect(title).toContain(`>${p.title}</span>`);
    }
    // Five different drawings.
    const drawings = (["source", "approval", "food", "ask", "read"] as const).map((k) => renderToStaticMarkup(<KindGlyph kind={k} />).replace(/data-glyph="[a-z]+"/, ""));
    expect(new Set(drawings).size).toBe(5);
  });

  it("an approval card is riveted at its four corners and its Yes is brass", () => {
    const out = html(APPROVAL);
    expect(out.match(/data-rivet=""/g)).toHaveLength(4);
    const yes = /<button type="button" data-action="yes" class="([^"]*)"/.exec(out)?.[1] ?? "";
    for (const k of ["mat-brass", "franki-card-press", "min-h-11", "focus-visible:outline-2"]) expect(yes.split(" ")).toContain(k);
    for (const p of [SOURCE, FOOD, ASK, READ]) expect(html(p)).not.toContain("data-rivet");
  });

  it("a figure is a mono 12 ink-dim label over a mono 28 value", () => {
    const out = html(SOURCE);
    expect(out).toMatch(/<dt class="font-mono text-xs [^"]*text-ink-dim">This month<\/dt>/);
    expect(out).toMatch(/<span class="font-mono text-2xl [^"]*">\$115 less<\/span>/);
  });

  it("lifts 2 px on hover on spring.press, and not under reduced motion", () => {
    expect(cardsCss).toMatch(/@media \(prefers-reduced-motion: no-preference\) and \(hover: hover\) \{\s*\.franki-card:hover \{ transform: translateY\(-2px\); \}/);
    expect(cardsCss).toMatch(/\.franki-card \{\s*transition: transform var\(--dur-base\) var\(--franki-spring-press\);/);
    expect(cardsCss).toContain('[data-reduced="true"] .franki-card:hover { transform: none; }');
  });

  it("the CSS press curve is spring.press sampled over dur.base", () => {
    const points = (/--franki-spring-press: linear\(([^)]*)\)/.exec(cardsCss)?.[1] ?? "").split(",").map(Number);
    const { stiffness: k, damping: c } = SPRING.press;
    const w0 = Math.sqrt(k);
    const z = c / (2 * w0);
    const wd = w0 * Math.sqrt(1 - z * z);
    const x = (t: number) => 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
    const n = points.length - 1;
    expect(n).toBeGreaterThanOrEqual(12);
    points.forEach((v, i) => expect(v).toBeCloseTo(i === n ? 1 : x((DUR.base / 1000) * (i / n)), 2));
    // Settled by the end: the last sampled step is within 2% of rest.
    expect(Math.abs(x(DUR.base / 1000) - 1)).toBeLessThan(0.02);
  });

  it("with source rows, a tag opens its rows inside the card and says so", () => {
    const out = renderToStaticMarkup(<Card {...SOURCE} sourceRows={{ bank: ROWS }} defaultOpenSource="bank" />);
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain(`aria-controls="${rowsElementId("c1", "bank")}"`);
    expect(out).toContain(`id="${rowsElementId("c1", "bank")}"`);
    expect(out).toContain('data-section="rows"');
    expect(out).toContain("Rows behind this number: Bank · 6 purchases");
    expect(out).toMatch(/>\$186<\/td>/);
    // The rows sit inside the card, right under the figure that cites them.
    expect(out.indexOf("data-source-rows")).toBeGreaterThan(out.indexOf('data-figure-source="bank"'));
    expect(out.indexOf("data-source-rows")).toBeLessThan(out.indexOf("</article>"));
    const closed = renderToStaticMarkup(<Card {...SOURCE} sourceRows={{ bank: ROWS }} />);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("data-source-rows");
  });

  it("a sources-row tag opens its rows below the sources row", () => {
    const p = { ...SOURCE, sources: [...sources, { id: "cal", label: "Calendar · 4 meetings" }] } as CardProps;
    const out = renderToStaticMarkup(<Card {...p} sourceRows={{ cal: ROWS }} defaultOpenSource="cal" />);
    expect(out.indexOf("data-source-rows")).toBeGreaterThan(out.indexOf('data-source="cal"'));
    expect(out).toContain("Rows behind this number: Calendar · 4 meetings");
    // A tag whose source has no rows says nothing about opening.
    expect(/<button[^>]*data-figure-source="bank"[^>]*>/.exec(out)?.[0]).not.toContain("aria-expanded");
  });

  it("a tap opens a source's rows, a second tap closes them, and a tag without rows changes nothing", () => {
    const rows = { bank: ROWS, empty: [] };
    expect(nextOpenSource(null, "bank", rows)).toBe("bank");
    expect(nextOpenSource("bank", "bank", rows)).toBeNull();
    expect(nextOpenSource("bank", "cal", rows)).toBe("bank");
    expect(nextOpenSource(null, "empty", rows)).toBeNull();
    expect(nextOpenSource(null, "bank", undefined)).toBeNull();
    fc.assert(
      fc.property(fc.option(fc.constantFrom("a", "b", "c"), { nil: null }), fc.constantFrom("a", "b", "c"), fc.subarray(["a", "b", "c"]), (open, tapped, withRows) => {
        const r = Object.fromEntries(withRows.map((id) => [id, ROWS]));
        const next = nextOpenSource(open, tapped, r);
        // The open source, when there is one, always has rows or was already open.
        if (next !== null && next !== open) expect(withRows).toContain(next);
        // Two taps on a tag with rows come back to where they started, unless that tag was open already.
        if (withRows.includes(tapped) && open !== tapped) expect(nextOpenSource(next, tapped, r)).toBeNull();
      }),
    );
  });

  it("a tap on a tag with rows opens them and still calls onOpenSource, once", () => {
    const onOpenSource = vi.fn();
    let open: string | null = null;
    const onTag = tagTapHandler((f) => (open = f(open)), { bank: ROWS }, onOpenSource);
    onTag("bank");
    expect(open).toBe("bank");
    expect(onOpenSource).toHaveBeenCalledWith("bank");
    onTag("bank");
    expect(open).toBeNull();
    onTag("cal");
    expect(open).toBeNull();
    expect(onOpenSource.mock.calls).toEqual([["bank"], ["bank"], ["cal"]]);
  });

  it("with openSource, the host holds which rows are open and a tap only reports it", () => {
    const rows = { bank: ROWS };
    const open = renderToStaticMarkup(<Card {...SOURCE} sourceRows={rows} openSource="bank" />);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("data-source-rows");
    // A held null wins over defaultOpenSource; a held source without rows shows nothing.
    for (const held of [null, "cal"]) {
      const out = renderToStaticMarkup(<Card {...SOURCE} sourceRows={rows} openSource={held} defaultOpenSource="bank" />);
      expect(out).toContain('aria-expanded="false"');
      expect(out).not.toContain("data-source-rows");
    }
    // A tap calls onOpenSource and nothing else; the host moves the open source on with nextOpenSource.
    const onOpenSource = vi.fn();
    let held: string | null = null;
    const tap = () => {
      onOpenSource.mockImplementationOnce((id: string) => (held = nextOpenSource(held, id, rows)));
      expect(click(Card({ ...SOURCE, onOpenSource, sourceRows: rows, openSource: held }), (p) => p["data-figure-source"] === "bank")).toBe(true);
    };
    tap();
    expect(held).toBe("bank");
    tap();
    expect(held).toBeNull();
    expect(onOpenSource.mock.calls).toEqual([["bank"], ["bank"]]);
  });

  it("renders nothing for empty props", () => {
    expect(html({ ...SOURCE, title: "" })).toBe("");
    expect(html({ ...(SOURCE as Extract<CardProps, { kind: "source" }>), body: " ", figures: [] })).toBe("");
    expect(html({ ...(APPROVAL as Extract<CardProps, { kind: "approval" }>), effect: "" })).toBe("");
    expect(html({ ...(ASK as Extract<CardProps, { kind: "ask" }>), options: [] })).toBe("");
    expect(html({ ...(READ as Extract<CardProps, { kind: "read" }>), lines: [] })).toBe("");
    expect(html({ ...(FOOD as Extract<CardProps, { kind: "food" }>), choice: "" })).toBe("");
  });
});
