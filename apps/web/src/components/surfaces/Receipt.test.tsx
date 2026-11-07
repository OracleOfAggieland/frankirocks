import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ReceiptKind, ReceiptProps } from "../../ui/surface-props";
import { Receipt } from "./Receipt";

const full: ReceiptProps = {
  blocked: true,
  cleaned: true,
  kept: [{ kind: "safety rule", count: 1 }],
  touched: [{ kind: "conversation turns", count: 3 }, { kind: "memories", count: 2 }],
};

describe("Receipt", () => {
  it("shows the status lines, what was kept and counts by kind", () => {
    const html = renderToStaticMarkup(<Receipt {...full} />);
    expect(html).toContain("Blocked now");
    expect(html).toContain("Cleaned up");
    expect(html).toContain("Kept: 1 safety rule");
    expect(html).toMatch(/data-kind="conversation turns".*>3</);
    expect(html).toMatch(/data-kind="memories".*>2</);
    expect(renderToStaticMarkup(<Receipt {...full} kept={[{ kind: "safety rule", count: 2 }]} />)).toContain("Kept: 2 safety rules");
  });

  it("shows only the lines that completed", () => {
    const html = renderToStaticMarkup(<Receipt {...full} cleaned={false} />);
    expect(html).toContain("Blocked now");
    expect(html).not.toContain("Cleaned up");
  });

  it("renders nothing when nothing completed", () => {
    expect(renderToStaticMarkup(<Receipt blocked={false} cleaned={false} kept={[]} touched={[]} />)).toBe("");
  });

  it("has no string field that could carry item text", () => {
    expectTypeOf<keyof ReceiptProps>().toEqualTypeOf<"blocked" | "cleaned" | "kept" | "touched">();
    expectTypeOf<ReceiptProps["blocked"]>().toEqualTypeOf<boolean>();
    expectTypeOf<ReceiptProps["cleaned"]>().toEqualTypeOf<boolean>();
    expectTypeOf<ReceiptProps["kept"][number]>().toEqualTypeOf<{ kind: "safety rule"; count: number }>();
    expectTypeOf<ReceiptProps["touched"][number]>().toEqualTypeOf<{ kind: ReceiptKind; count: number }>();
    expectTypeOf<string>().not.toExtend<ReceiptKind>();
  });
});
