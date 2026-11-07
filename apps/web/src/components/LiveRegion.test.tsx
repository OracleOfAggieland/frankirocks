import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveRegion } from "./LiveRegion";

describe("LiveRegion", () => {
  it("is one visually hidden polite atomic region", () => {
    const html = renderToStaticMarkup(<LiveRegion message="Franki is listening. Call connected." seq={1} />);
    expect(html.match(/aria-live=/g)).toHaveLength(1);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("sr-only");
    expect(html).toContain("Franki is listening. Call connected.");
  });

  it("alternates its child node so a repeat is spoken again", () => {
    const a = renderToStaticMarkup(<LiveRegion message="Call idle." seq={2} />);
    const b = renderToStaticMarkup(<LiveRegion message="Call idle." seq={3} />);
    expect(a).toContain('data-slot="a"');
    expect(b).toContain('data-slot="b"');
    expect(renderToStaticMarkup(<LiveRegion message={null} seq={0} />)).not.toContain("data-slot");
  });
});
