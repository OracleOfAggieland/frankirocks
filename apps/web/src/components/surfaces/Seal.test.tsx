import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Seal } from "./Seal";
import { Seam } from "./Seam";

const css = readFileSync(join(import.meta.dirname, "cards.css"), "utf8");

describe("Seal and Seam", () => {
  it("the seal has an accessible name and a brass fill", () => {
    const html = renderToStaticMarkup(<Seal />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Locked rule"');
    // Brief 015: an embossed brass disc on the shared material (was bg-brass).
    expect(html).toMatch(/data-seal-part="disc" class="[^"]*mat-brass/);
  });

  it("the seal is an embossed disc: a scalloped edge, an inner ring and the lock, all decorative", () => {
    const html = renderToStaticMarkup(<Seal label="No peanuts" />);
    expect(html).toContain('aria-label="No peanuts"');
    for (const part of ["disc", "ring", "lock"]) expect(html).toContain(`data-seal-part="${part}"`);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
    expect(html).toContain("franki-seal-disc");
    // Twelve scallops: the clip path has twelve outermost points (radius 50%).
    const polygon = /\.franki-seal-disc \{\s*clip-path: polygon\(([^)]*)\)/.exec(css)?.[1] ?? "";
    const points = polygon.split(",").map((p) => p.trim().split(/\s+/).map((v) => parseFloat(v) - 50));
    const radii = points.map(([x, y]) => Math.hypot(x, y));
    expect(radii.filter((r) => r > 49.9)).toHaveLength(12);
    expect(Math.min(...radii)).toBeGreaterThan(44);
  });

  it("the seam is hidden from assistive tech and drawn in stitch", () => {
    const html = renderToStaticMarkup(<Seam />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("var(--color-stitch)");
  });

  it("the seam needs no element ID, so any number of seams can share a page", () => {
    const html = renderToStaticMarkup(<Seam />);
    expect(html).not.toMatch(/\bid="/);
    expect(html).not.toContain("url(#");
    // One stitch every 14 px: a 9 + 5 dash and a 1 + 13 tick, the tick centred on the dash.
    expect(html).toContain('stroke-dasharray="9 5"');
    expect(html).toContain('stroke-dasharray="1 13"');
    expect(html).toContain("pointer-events-none");
  });

  it("a fading seam fades toward both ends", () => {
    expect(renderToStaticMarkup(<Seam fade />)).toMatch(/data-seam="fade"[^>]*mask-image:linear-gradient\(to right, transparent/);
    expect(renderToStaticMarkup(<Seam />)).not.toContain("mask-image");
  });
});
