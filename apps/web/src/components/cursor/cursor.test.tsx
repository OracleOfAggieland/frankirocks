import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../../ui/copy";
import { SpiderCursor } from "./SpiderCursor";
import { SpiderSwitch, SpiderToggle } from "./SpiderToggle";

const noop = () => {};

describe("Lab spider on the server", () => {
  it("the spider and its toggle render nothing on the server", () => {
    expect(renderToStaticMarkup(<SpiderCursor />)).toBe("");
    expect(renderToStaticMarkup(<SpiderToggle />)).toBe("");
  });
});

describe("Lab spider switch", () => {
  it("is a labelled switch with a 44 px target and a focus ring", () => {
    const html = renderToStaticMarkup(<SpiderSwitch on onToggle={noop} />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('type="button"');
    expect(html).toContain(COPY.cursor.toggle);
    expect(html).toContain("min-h-11");
    expect(html).toContain("focus-visible:outline-2");
    expect(html).toContain("mat-brass");
  });

  it("shows off as an outline, without brass", () => {
    const html = renderToStaticMarkup(<SpiderSwitch on={false} onToggle={noop} />);
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain("mat-brass");
  });
});

describe("Lab spider CSS", () => {
  const css = readFileSync(join(__dirname, "cursor.css"), "utf8");

  it("hides the native cursor only under data-spider, a fine pointer and motion allowed", () => {
    const media = css.indexOf("@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    expect(media).toBeGreaterThanOrEqual(0);
    const hide = css.indexOf("cursor: none");
    expect(hide).toBeGreaterThan(media);
    expect(css.slice(media, hide)).toContain('html[data-spider="on"]');
  });

  it("keeps the native text cursor in text fields", () => {
    expect(css).toMatch(/textarea[\s\S]*cursor: text !important/);
  });

  it("the drawing takes no pointer events", () => {
    const layer = css.slice(css.indexOf(".spider-layer {"), css.indexOf("}", css.indexOf(".spider-layer {")));
    expect(layer).toContain("pointer-events: none");
    const webs = css.slice(css.indexOf(".spider-webs {"), css.indexOf("}", css.indexOf(".spider-webs {")));
    expect(webs).toContain("pointer-events: none");
  });
});
