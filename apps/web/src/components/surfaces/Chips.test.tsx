import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Chips } from "./Chips";

const CHIPS = ["What do you know about me?", "What's on today?"] as const;

describe("Chips", () => {
  it("renders one capsule button per chip with a stitched outline", () => {
    const html = renderToStaticMarkup(<Chips chips={CHIPS} disabled={false} onChip={() => {}} />);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("rounded-chip");
    expect(html).toContain("border-dashed border-stitch");
    expect(html).toContain("border-brass");
  });

  it("calls onChip with the chip's text", () => {
    const onChip = vi.fn();
    const tree = Chips({ chips: CHIPS, disabled: false, onChip }) as { props: { children: { props: { children: { props: { onClick: () => void } } } }[] } };
    tree.props.children[1].props.children.props.onClick();
    expect(onChip).toHaveBeenCalledWith("What's on today?");
  });

  it("disables every chip per props", () => {
    expect(renderToStaticMarkup(<Chips chips={CHIPS} disabled onChip={() => {}} />).match(/disabled=""/g)).toHaveLength(2);
  });

  it("renders nothing with no chips", () => {
    expect(renderToStaticMarkup(<Chips chips={[]} disabled={false} onChip={() => {}} />)).toBe("");
  });
});
