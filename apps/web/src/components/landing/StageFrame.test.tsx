import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING } from "../../ui/copy-landing";
import { StageFrame } from "./StageFrame";

describe("the stage frame", () => {
  it("draws a decorative edge with four corner ticks and takes no pointer events", () => {
    const html = renderToStaticMarkup(<StageFrame frame plate fig={null} />);
    expect(html).toMatch(/^<div data-stage-frame="" data-on="true" class="[^"]*pointer-events-none/);
    expect(html).toContain('aria-hidden="true" data-frame-edge=""');
    expect(html).toContain("rounded-frame");
    expect(html.match(/data-tick=/g)).toHaveLength(4);
  });

  it("shows the brass plate with the equipment and hides it otherwise", () => {
    const on = renderToStaticMarkup(<StageFrame frame plate fig={null} />);
    expect(on).toContain('data-demo-plate="" data-on="true"');
    expect(on).toContain(`data-plate="brass"`);
    expect(on).toContain(`>${LANDING.stage.plate}</span>`);
    const off = renderToStaticMarkup(<StageFrame frame={false} plate={false} fig={null} />);
    expect(off).toContain('data-demo-plate="" data-on="false" aria-hidden="true"');
    expect(off).toContain('data-stage-frame="" data-on="false"');
  });

  it("draws the fig label as a hidden annotation", () => {
    const html = renderToStaticMarkup(<StageFrame frame={false} plate={false} fig={{ n: "1", text: LANDING.hero.alive }} />);
    expect(html).toContain('aria-hidden="true" data-demo-fig=""');
    expect(html).toContain('data-fig="1"');
    expect(html).toContain(LANDING.hero.alive.replace("'", "&#x27;"));
  });
});
