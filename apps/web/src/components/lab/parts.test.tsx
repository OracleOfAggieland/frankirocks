import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FigLabel } from "./FigLabel";
import { Lamp } from "./Lamp";
import { Plate } from "./Plate";
import { Rivet } from "./Rivet";

describe("shared lab parts (brief 015)", () => {
  it("a rivet is decorative and takes no pointer events", () => {
    const html = renderToStaticMarkup(<Rivet />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("data-rivet");
  });

  it("a plate is brass by default and gold on request", () => {
    expect(renderToStaticMarkup(<Plate>The Lab</Plate>)).toMatch(/data-plate="brass" class="mat-brass [^"]*"[^>]*>The Lab</);
    expect(renderToStaticMarkup(<Plate tone="gold">$115 less</Plate>)).toMatch(/data-plate="gold" class="mat-gold /);
  });

  it("a lamp says its state to screen readers and hides its dot", () => {
    const off = renderToStaticMarkup(<Lamp on={false} />);
    expect(off).toContain('data-lamp="off"');
    expect(off).toContain('<span class="sr-only">Off</span>');
    const on = renderToStaticMarkup(<Lamp on words={{ on: "Counting", off: "No counts yet" }} />);
    expect(on).toContain('data-lamp="on"');
    expect(on).toContain('<span class="sr-only">Counting</span>');
    expect(on).toMatch(/<span aria-hidden="true" class="[^"]*bg-ecto/);
  });

  it("a fig label is readable ink-dim text with a decorative stitch leader on either side", () => {
    const left = renderToStaticMarkup(<FigLabel n="2">The bench</FigLabel>);
    expect(left).toContain('data-fig="2"');
    expect(left).toContain("text-ink-dim");
    expect(left).not.toMatch(/text-stitch/);
    expect(left.indexOf("data-fig-leader")).toBeLessThan(left.indexOf("The bench"));
    const right = renderToStaticMarkup(
      <FigLabel n="3" side="right">
        The slab
      </FigLabel>,
    );
    expect(right.indexOf("data-fig-leader")).toBeGreaterThan(right.indexOf("The slab"));
  });

  it("the materials file defines each of the five materials once", () => {
    const css = readFileSync(join(import.meta.dirname, "materials.css"), "utf8");
    for (const name of ["mat-blueprint", "mat-glass", "mat-brass", "mat-paper", "mat-gold"]) {
      expect(css.match(new RegExp(`@utility ${name} \\{`, "g")), name).toHaveLength(1);
    }
  });
});
