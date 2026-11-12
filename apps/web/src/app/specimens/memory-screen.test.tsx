import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SpecimensPage from "./page.dev";

describe("Specimens_Page: main screen on memory data (brief 020)", () => {
  it("shows the jar, the Lab with its receipt, the strip and the chip, filled through the view-model", () => {
    const html = renderToStaticMarkup(<SpecimensPage />);
    const start = html.indexOf('data-section-id="memory-screen"');
    expect(start).toBeGreaterThan(-1);
    const section = html.slice(start, html.indexOf("data-section-id=", start + 10) === -1 ? undefined : html.indexOf("data-section-id=", start + 10));
    for (const mark of ["data-jar=", "data-lab=", "data-strip=", "data-chips=", "What do you know about me?", "Read emails", "Receipt"]) expect(section, mark).toContain(mark);
  });
});
