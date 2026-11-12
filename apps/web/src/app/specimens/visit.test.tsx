import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SpecimensPage from "./page.dev";

describe("Specimens_Page: the visit, the bolt and the sheet (brief 027)", () => {
  it("shows every visit state, the bolt's targets, the badge and the read-only sheet on fixture rows", () => {
    const html = renderToStaticMarkup(<SpecimensPage />);
    const start = html.indexOf('data-section-id="visit"');
    expect(start).toBeGreaterThan(-1);
    const next = html.indexOf("data-section-id=", start + 10);
    const section = html.slice(start, next === -1 ? undefined : next);
    for (const mark of [
      'data-visit="cloning"',
      'data-visit="ready"',
      'data-visit="resetting"',
      'data-visit="failed"',
      'data-bolt="waiting"',
      'data-start-over="confirming"',
      "Thursday, 6 PM",
      "Three weeks on",
      "data-time-badge=",
      'data-sheet=""',
      "Biscuit has surgery Thursday",
      "Other things",
      "data-sheet-footer",
      "Enter the lab",
    ])
      expect(section, mark).toContain(mark);
    expect(section).not.toContain('data-action="forget"');
  });
});
