import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Lab } from "./Lab";
import { formatCount } from "./Odometer";

describe("Lab", () => {
  it("shows real values in mono and — for null, never a placeholder zero", () => {
    const html = renderToStaticMarkup(
      <Lab counters={[{ id: "read", label: "Read emails", value: 12 }, { id: "said", label: "Said", value: null }]} limits={[]} />,
    );
    expect(html).toMatch(/data-counter="read".*>12</);
    expect(html).toMatch(/data-counter="said".*>—</);
    expect(html).toContain("font-mono");
    expect(html).not.toMatch(/data-counter="said"[^]*?>0</);
    expect(formatCount(null)).toBe("—");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(NaN)).toBe("—");
  });

  it("has a fold for honest limits", () => {
    const html = renderToStaticMarkup(<Lab counters={[{ id: "a", label: "A", value: 1 }]} limits={["I can't read texts yet."]} />);
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("I can&#x27;t read texts yet.");
  });

  it("renders nothing with no counters", () => {
    expect(renderToStaticMarkup(<Lab counters={[]} limits={["x"]} />)).toBe("");
  });
});
