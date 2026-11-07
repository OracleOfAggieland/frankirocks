import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import type { CaptionsProps } from "../../ui/surface-props";
import { Captions } from "./Captions";

const render = (p: Partial<CaptionsProps>) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced>
      <Captions on={false} line={{ id: "l1", text: "Pip is a good dog." }} onToggle={() => {}} {...p} />
    </ReducedMotionOverride>,
  );

describe("Captions", () => {
  it("is off by default: a toggle and no line", () => {
    const html = render({});
    expect(html).toContain('data-captions="off"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">Captions<");
    expect(html).not.toContain("Pip is a good dog.");
  });

  it("shows exactly one line when on, with no history", () => {
    const html = render({ on: true });
    expect(html.match(/data-caption-line/g)).toHaveLength(1);
    expect(html).toContain("Pip is a good dog.");
    expect(render({ on: true, line: null })).not.toContain("data-caption-line");
  });

  it("the toggle looks different on and off, with aria-pressed as the state", () => {
    const toggle = (html: string) => /<button[^>]*>/.exec(html)?.[0] ?? "";
    const off = render({});
    const on = render({ on: true });
    expect(toggle(on)).toContain('aria-pressed="true"');
    expect(toggle(on)).toContain("border-brass");
    expect(toggle(on)).toContain("bg-brass/15");
    expect(on).toContain('data-toggle-dot="on"');
    expect(toggle(off)).toContain("border-ink-dim");
    expect(toggle(off)).not.toContain("bg-brass");
    expect(off).toContain('data-toggle-dot="off"');
    for (const html of [on, off]) {
      expect(toggle(html)).toContain("min-h-11");
      expect(toggle(html)).toContain("focus-visible:outline-2");
    }
  });

  it("the toggle calls onToggle", () => {
    const onToggle = vi.fn();
    const tree = Captions({ on: false, line: null, onToggle }) as { props: { children: { props: { onClick: () => void } }[] } };
    tree.props.children[0].props.onClick();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
