import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import { Odometer, formatCount } from "./Odometer";

const moving = (node: React.ReactNode) => renderToStaticMarkup(<ReducedMotionOverride reduced={false}>{node}</ReducedMotionOverride>);

describe("Odometer", () => {
  it("keeps formatCount: en-US grouping, — for a missing value, 0 for zero", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(NaN)).toBe("—");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1284)).toBe("1,284");
  });

  it("gives screen readers the whole number once and hides the drums", () => {
    const html = moving(<Odometer value={1284} places={4} />);
    expect(html).toMatch(/^<span data-odometer="" class="odo-well font-mono[^"]*"><span class="sr-only">1,284<\/span><span aria-hidden="true" class="odo-bank">/);
  });

  it("has one ten-face drum per digit, and the separator stands still", () => {
    const html = moving(<Odometer value={1284} places={4} />);
    expect(html.match(/class="odo-drum"/g)).toHaveLength(4);
    expect(html.match(/class="odo-face"/g)).toHaveLength(40);
    expect(html).toContain('<span class="odo-still">,</span>');
    for (const key of ["p0", "p1", "p2", "p4"]) expect(html).toContain(`data-drum="${key}"`);
    // Each drum is turned to its digit: 4 faces for the ones place is 144 degrees.
    expect(html).toMatch(/data-drum="p0"[^]*?transform:\s*rotateX\(144deg\)/);
  });

  it("leaves the places a short number does not reach as empty windows", () => {
    const html = moving(<Odometer value={7} places={3} />);
    expect(html.match(/data-empty=""/g)).toHaveLength(2);
    expect(html.match(/class="odo-drum"/g)).toHaveLength(1);
  });

  it("shows a missing value as a blank drum with —, never a zero", () => {
    for (const html of [moving(<Odometer value={null} places={3} />), renderToStaticMarkup(<Odometer value={null} places={3} />)]) {
      expect(html).toContain('data-blank=""');
      expect(html).toContain('<span class="odo-flat text-ink-dim">—</span>');
      expect(html).not.toMatch(/>0</);
      expect(html).not.toContain("odo-drum");
    }
  });

  it("under reduced motion shows each digit flat, with no drum to roll", () => {
    const html = renderToStaticMarkup(
      <ReducedMotionOverride reduced>
        <Odometer value={128} places={3} />
      </ReducedMotionOverride>,
    );
    expect(html).not.toContain("odo-drum");
    expect(html).not.toContain("rotateX");
    expect(html).toMatch(/data-drum="p2" class="odo-window"><span class="odo-flat">1<\/span>[^]*>2<[^]*>8</);
  });

  it("never changes width for values that fit its places", () => {
    const cells = (v: number | null) => moving(<Odometer value={v} places={4} />).match(/class="odo-(window|still)"/g)?.length;
    expect(new Set([null, 0, 7, 99, 1000, 9999].map(cells))).toEqual(new Set([5]));
  });
});
