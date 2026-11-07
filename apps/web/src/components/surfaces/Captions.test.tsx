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

  it("the toggle calls onToggle", () => {
    const onToggle = vi.fn();
    const tree = Captions({ on: false, line: null, onToggle }) as { props: { children: { props: { onClick: () => void } }[] } };
    tree.props.children[0].props.onClick();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
