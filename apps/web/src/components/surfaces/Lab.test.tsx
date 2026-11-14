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

  it("shows no limits and no fold, whatever limits it is given (owner, Nov 14)", () => {
    const html = renderToStaticMarkup(<Lab counters={[{ id: "a", label: "A", value: 1 }]} limits={["I can't read texts yet."]} />);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).not.toContain("read texts");
    expect(html).not.toContain("What I can");
  });

  it("renders nothing with no counters", () => {
    expect(renderToStaticMarkup(<Lab counters={[]} limits={["x"]} />)).toBe("");
  });

  it("is an instrument panel: glass, four corner rivets, and a bezel with the plate and a lamp", () => {
    const html = renderToStaticMarkup(<Lab counters={[{ id: "read", label: "Read emails", value: 12 }]} limits={[]} />);
    expect(html).toMatch(/data-lab="" class="mat-glass /);
    expect(html.match(/data-rivet/g)).toHaveLength(4);
    expect(html).toMatch(/data-lab-bezel=""[^]*data-plate="brass"[^>]*>The Lab<[^]*data-lamp="on"/);
    expect(html).toContain('<span class="sr-only">Counting</span>');
    // The plate repeats the panel's name, so only the aria-label reads it.
    expect(html).toMatch(/<span aria-hidden="true" class="inline-flex"><span data-plate="brass"/);
  });

  it("leaves the lamp off while no counter has a value", () => {
    const html = renderToStaticMarkup(<Lab counters={[{ id: "a", label: "A", value: null }, { id: "b", label: "B", value: NaN }]} limits={[]} />);
    expect(html).toContain('data-lamp="off"');
    expect(html).toContain('<span class="sr-only">No counts yet</span>');
  });

  it("shows each label in 14 ink-dim beside an odometer, every bank built for the same places", () => {
    const html = renderToStaticMarkup(
      <Lab counters={[{ id: "read", label: "Read emails", value: 1284 }, { id: "said", label: "Said", value: 7 }]} limits={[]} />,
    );
    expect(html).toMatch(/<dt class="[^"]*text-sm text-ink-dim[^"]*">Read emails<\/dt>/);
    const banks = html.split("data-odometer").slice(1);
    expect(banks).toHaveLength(2);
    const cellsIn = (bank: string) => bank.match(/class="odo-(window|still)"/g)?.length;
    expect(cellsIn(banks[0])).toBe(5);
    expect(cellsIn(banks[1])).toBe(5);
  });

  it("opens a slot along its top edge only when a receipt prints from it", () => {
    const without = renderToStaticMarkup(<Lab counters={[{ id: "a", label: "A", value: 1 }]} limits={[]} />);
    expect(without).not.toContain("data-lab-slot");
    const html = renderToStaticMarkup(<Lab counters={[{ id: "a", label: "A", value: 1 }]} limits={[]} receipt={<p data-slip="">slip</p>} />);
    // The slip sits just above the panel, in flow on phones and rising out of the slot from 640 px.
    expect(html).toMatch(/^<div data-lab-column=""[^>]*><div data-lab-receipt="" class="relative [^"]*sm:absolute sm:bottom-\[calc\(100%-2px\)\][^"]*"><p data-slip="">slip<\/p><\/div><section [^>]*data-lab=""/);
    expect(html).toMatch(/data-lab=""[^>]*><span aria-hidden="true" data-lab-slot="" class="lab-slot pointer-events-none /);
    expect(without).toMatch(/^<section /);
  });

  it("still prints a receipt when there are no counts yet", () => {
    const html = renderToStaticMarkup(<Lab counters={[]} limits={[]} receipt={<p data-slip="">slip</p>} />);
    expect(html).toBe('<p data-slip="">slip</p>');
  });
});
