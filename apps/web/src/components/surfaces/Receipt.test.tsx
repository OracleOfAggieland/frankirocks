import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
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
    expect(html).toMatch(/data-line="blocked"[^>]*><dt>Blocked now<\/dt><dd[^>]*><span data-status="done"/);
    expect(html).toMatch(/data-line="cleaned"[^>]*><dt>Cleaned up<\/dt><dd[^>]*><span data-status="done"/);
    expect(html).toMatch(/data-line="kept"[^>]*><dt>Kept<\/dt><dd[^>]*>1 safety rule</);
    expect(html).toContain("Touched");
    expect(html).toMatch(/data-kind="conversation turns".*>3</);
    expect(html).toMatch(/data-kind="memories".*>2</);
    expect(renderToStaticMarkup(<Receipt {...full} kept={[{ kind: "safety rule", count: 2 }]} />)).toContain(">2 safety rules<");
  });

  it("marks a step that has not completed with a dash, never a tick", () => {
    const html = renderToStaticMarkup(<Receipt {...full} cleaned={false} />);
    expect(html).toMatch(/data-line="blocked".*?data-status="done"/);
    expect(html).toMatch(/data-line="cleaned"[^>]*><dt>Cleaned up<\/dt><dd[^>]*><span data-status="not-yet"><span aria-hidden="true">—<\/span><span class="sr-only">Not yet</);
    expect(html.match(/data-status="done"/g)).toHaveLength(1);
  });

  it("leaves out kept and touched rows with no count", () => {
    const html = renderToStaticMarkup(<Receipt {...full} kept={[{ kind: "safety rule", count: 0 }]} touched={[{ kind: "sources", count: 0 }]} />);
    expect(html).not.toContain('data-line="kept"');
    expect(html).not.toContain("Touched");
    expect(html).not.toContain("data-kind=");
  });

  it("renders nothing when nothing completed", () => {
    expect(renderToStaticMarkup(<Receipt blocked={false} cleaned={false} kept={[]} touched={[]} />)).toBe("");
  });

  it("is paper with perforated ends, in mono, with a printed seal on the kept line", () => {
    const html = renderToStaticMarkup(<Receipt {...full} />);
    expect(html).toMatch(/aria-label="Receipt" data-receipt="" class="receipt-paper mat-paper [^"]*font-mono/);
    expect(html).toMatch(/data-line="kept"[^]*?data-receipt-seal=""[^]*?<\/dd>/);
    expect(html.match(/data-receipt-seal/g)).toHaveLength(1);
    expect(html).toContain("border-dashed");
    // Labels and values are joined by dotted leaders drawn in CSS, not by text.
    expect(html).toContain('class="receipt-row ');
    expect(html).toContain('<span class="receipt-leader">memories</span>');
  });

  it("feeds up out of a clipping slot, and under reduced motion only fades", () => {
    const moving = renderToStaticMarkup(
      <ReducedMotionOverride reduced={false}>
        <Receipt {...full} />
      </ReducedMotionOverride>,
    );
    expect(moving).toMatch(/^<div data-receipt-feed="" class="[^"]*overflow-hidden[^"]*"><div class="receipt-slip" style="[^"]*translateY\(100%\)/);
    const still = renderToStaticMarkup(<Receipt {...full} />);
    expect(still).toMatch(/<div class="receipt-slip" style="opacity:0"/);
    expect(still).not.toContain("translateY");
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
