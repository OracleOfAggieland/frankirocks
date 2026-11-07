import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CardProps } from "../../ui/surface-props";
import { Card } from "./Card";

const noop = () => {};
const sources = [{ id: "bank", label: "Bank · 6 purchases" }];
const SOURCE: CardProps = {
  kind: "source", id: "c1", title: "Takeout nights", sources, onOpenSource: noop,
  body: "Mostly on nights with meetings after 6.", figures: [{ label: "This month", value: "$115 less", sourceId: "bank" }],
};
const APPROVAL: CardProps = { kind: "approval", id: "c2", title: "Book a table", sources: [], onOpenSource: noop, effect: "I'll book a table for two at 7 PM.", onYes: noop, onNotNow: noop };
const FOOD: CardProps = {
  kind: "food", id: "c3", title: "Dinner pick", sources: [], onOpenSource: noop, choice: "Pad thai, no peanuts", ingredients: ["rice noodles", "egg"],
  checkedFor: [{ person: "Sam", rules: [{ id: "r1", person: "Sam", text: "No peanuts" }] }], onRemoveRule: noop,
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

  it("puts every number in mono with a source tag that opens its rows", () => {
    const onOpenSource = vi.fn();
    const out = html(SOURCE);
    expect(out).toMatch(/class="font-mono[^"]*"[^>]*>\$115 less/);
    expect(out).toContain('data-figure-source="bank"');
    expect(click(Card({ ...SOURCE, onOpenSource }), (p) => p["data-figure-source"] === "bank")).toBe(true);
    expect(click(Card({ ...SOURCE, onOpenSource }), (p) => p["data-source"] === "bank")).toBe(true);
    expect(onOpenSource).toHaveBeenCalledWith("bank");
    expect(onOpenSource).toHaveBeenCalledTimes(2);
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

  it("removes a hard rule only through its Remove button", () => {
    const onRemoveRule = vi.fn();
    const card = Card({ ...(FOOD as Extract<CardProps, { kind: "food" }>), onRemoveRule });
    expect(click(card, (p) => typeof p["aria-label"] === "string" && (p["aria-label"] as string).startsWith("Remove"))).toBe(true);
    expect(onRemoveRule).toHaveBeenCalledWith("r1");
    const out = html(FOOD);
    expect(out).not.toMatch(/onSwipe|dismiss|draggable/i);
    expect(html({ ...(FOOD as Extract<CardProps, { kind: "food" }>), onRemoveRule: undefined })).not.toContain(">Remove<");
  });

  it("ask calls onAnswer with the option ID", () => {
    const onAnswer = vi.fn();
    click(Card({ ...(ASK as Extract<CardProps, { kind: "ask" }>), onAnswer }), (p) => p["data-action"] === "answer-b");
    expect(onAnswer).toHaveBeenCalledWith("b");
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
