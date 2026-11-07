import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StripProps } from "../../ui/surface-props";
import { LABEL_BOX, STRIP_LAYOUT, STRIP_LIST, Strip } from "./Strip";

const html = (p: Partial<StripProps>) => renderToStaticMarkup(<Strip open filled={0} resultLabel="$115 less" {...p} />);

describe("Strip", () => {
  it.each([0, 1, 2, 3, 4, 5] as const)("renders five terminals with %i filled", (filled) => {
    const out = html({ filled });
    expect(out.match(/data-terminal=/g)).toHaveLength(5);
    expect(out.match(/data-on="true"/g)?.length ?? 0).toBe(filled);
    for (const label of ["Noticed", "Connected", "Suggested", "You said yes", "$115 less"]) expect(out).toContain(label);
  });

  it("turns the last terminal gold only when filled", () => {
    expect(html({ filled: 5 })).toContain("bg-gold");
    expect(html({ filled: 4 })).not.toContain("bg-gold");
  });

  it("renders nothing when no loop is open", () => {
    expect(html({ open: false, filled: 3 })).toBe("");
  });

  it("gives every terminal a label box of one fixed width, at most two lines", () => {
    const out = html({ filled: 2 });
    const boxes = [...out.matchAll(/<span data-label-box="" class="([^"]*)"/g)].map((m) => m[1]);
    expect(boxes).toHaveLength(STRIP_LAYOUT.terminals);
    const widths = boxes.map((c) => c.split(" ").filter((k) => /^w-/.test(k)));
    for (const w of widths) expect(w).toEqual(["w-24"]);
    for (const c of boxes) {
      expect(c).toContain("line-clamp-2");
      expect(c).toContain("shrink-0");
    }
    // w-24 is 6rem, the labelRem the layout is computed from.
    expect(STRIP_LAYOUT.labelRem * 4).toBe(24);
  });

  it("leaves a gap between neighbouring label boxes in both layouts", () => {
    const { labelRem, gapRem, rowGapRem, acrossRem, terminals } = STRIP_LAYOUT;
    expect(gapRem).toBeGreaterThan(0);
    expect(rowGapRem).toBeGreaterThan(0);
    // Across: one track per terminal, each exactly the label box width, with the gap between tracks.
    expect(STRIP_LIST).toContain(`@min-[${acrossRem}rem]:grid-cols-[repeat(${terminals},${labelRem}rem)]`);
    expect(STRIP_LIST).toContain(`@min-[${acrossRem}rem]:gap-x-${gapRem * 4}`);
    // The column layout switches to across only where all five boxes and four gaps fit.
    expect(terminals * labelRem + (terminals - 1) * gapRem).toBeLessThanOrEqual(acrossRem);
    // Down: a row gap between terminals.
    expect(STRIP_LIST).toContain(`gap-y-${rowGapRem * 4}`);
    expect(LABEL_BOX).toContain(`@min-[${acrossRem}rem]:text-center`);
    // The across wire spans one track plus one gap; the down wire one row plus one row gap.
    const out = html({ filled: 5 });
    expect(out).toContain(`w-[calc(100%+${gapRem}rem)]`);
    expect(out).toContain(`h-[calc(100%+${rowGapRem}rem)]`);
  });

  it("lays the wire along both axes, lit up to the last filled terminal", () => {
    const out = html({ filled: 3 });
    expect(out.match(/data-wire-track="x"/g)).toHaveLength(4);
    expect(out.match(/data-wire-track="y"/g)).toHaveLength(4);
  });
});
