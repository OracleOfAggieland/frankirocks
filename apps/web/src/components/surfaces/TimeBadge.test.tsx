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
    expect(html).toContain("border-brass");
  });

  it("renders nothing when not simulated", () => {
    expect(renderToStaticMarkup(<TimeBadge simulated={false} instantMs={THU_6PM_CHICAGO} zone="UTC" />)).toBe("");
  });
});
