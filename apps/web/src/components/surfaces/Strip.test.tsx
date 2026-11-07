import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StripProps } from "../../ui/surface-props";
import { Strip } from "./Strip";

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
});
