import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimeBadge } from "./TimeBadge";

const THU_6PM_CHICAGO = Date.UTC(2026, 10, 6, 0, 0, 0);

describe("TimeBadge", () => {
  it("reads Simulated: day and time with a bolt", () => {
    const html = renderToStaticMarkup(<TimeBadge simulated instantMs={THU_6PM_CHICAGO} zone="America/Chicago" />);
    expect(html).toContain("Simulated:");
    expect(html).toContain("Thu 6:00 PM");
    expect(html).toContain("<svg");
    // Brief 015: a brass plate, the shared Plate part (was a brass-bordered pill).
    expect(html).toMatch(/data-plate="brass" class="mat-brass /);
  });

  it("the bolt is decorative and engraved in the plate's own ink", () => {
    const html = renderToStaticMarkup(<TimeBadge simulated instantMs={THU_6PM_CHICAGO} zone="America/Chicago" />);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*class="franki-badge-bolt/);
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain("whitespace-nowrap");
  });

  it("renders nothing when not simulated", () => {
    expect(renderToStaticMarkup(<TimeBadge simulated={false} instantMs={THU_6PM_CHICAGO} zone="UTC" />)).toBe("");
  });
});
