import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Seal } from "./Seal";
import { Seam } from "./Seam";

describe("Seal and Seam", () => {
  it("the seal has an accessible name and a brass fill", () => {
    const html = renderToStaticMarkup(<Seal />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Locked rule"');
    expect(html).toContain("bg-brass");
  });

  it("the seam is hidden from assistive tech and drawn in stitch", () => {
    const html = renderToStaticMarkup(<Seam />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("var(--color-stitch)");
  });
});
