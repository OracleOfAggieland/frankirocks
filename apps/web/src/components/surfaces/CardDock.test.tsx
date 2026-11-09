import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CardProps } from "../../ui/surface-props";
import { CardDock } from "./CardDock";

const card = (id: string): CardProps => ({ kind: "read", id, title: `Card ${id}`, sources: [], onOpenSource: () => {}, lines: [`line ${id}`] });

describe("CardDock", () => {
  it("shows one primary card and stacks up to two older ones smaller", () => {
    const html = renderToStaticMarkup(<CardDock cards={[card("a"), card("b"), card("c"), card("d")]} />);
    expect(html.match(/data-depth="/g)).toHaveLength(3);
    expect(html).toContain('data-depth="0" data-scale="1"');
    expect(html).toContain('data-depth="1" data-scale="0.96"');
    expect(html).toContain('data-depth="2" data-scale="0.92"');
    expect(html).not.toContain("Card d");
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.indexOf('data-depth="0"')).toBeGreaterThan(html.indexOf('data-depth="2"'));
  });

  it("older cards show only their edges: no content, inert and hidden", () => {
    const html = renderToStaticMarkup(<CardDock cards={[card("a"), card("b"), card("c")]} />);
    expect(html).toContain("Card a");
    expect(html).toContain("line a");
    for (const older of ["Card b", "line b", "Card c", "line c"]) expect(html).not.toContain(older);
    expect(html.match(/data-stack-edge=""/g)).toHaveLength(2);
    expect(html.match(/data-card="/g)).toHaveLength(1);
    for (const depth of [1, 2]) {
      const tag = new RegExp(`<div[^>]*data-depth="${depth}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(tag).toContain('aria-hidden="true"');
      expect(tag).toContain("inert");
    }
    const front = /<div[^>]*data-depth="0"[^>]*>/.exec(html)?.[0] ?? "";
    expect(front).not.toContain("aria-hidden");
    expect(front).not.toContain("inert");
  });

  it("is a bottom sheet below 1024 px and a column from 1024 px", () => {
    const html = renderToStaticMarkup(<CardDock cards={[card("a")]} />);
    expect(html).toMatch(/class="fixed inset-x-0 bottom-0[^"]*lg:static/);
  });

  it("renders nothing with no cards", () => {
    expect(renderToStaticMarkup(<CardDock cards={[]} />)).toBe("");
    expect(renderToStaticMarkup(<CardDock cards={[{ ...card("x"), title: "" }]} />)).toBe("");
  });
});
