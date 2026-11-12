import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Chips } from "./Chips";

const CHIPS = ["What do you know about me?", "What's on today?"] as const;
const css = readFileSync(join(import.meta.dirname, "cards.css"), "utf8");

describe("Chips", () => {
  it("renders one capsule button per chip with a stitched outline", () => {
    const html = renderToStaticMarkup(<Chips chips={CHIPS} disabled={false} onChip={() => {}} />);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("rounded-chip");
    // Brief 015: the stitched outline is a dashed SVG outline in stitch (was a dashed CSS border), so its
    // stitches can run.
    expect(html.match(/data-stitch=""/g)).toHaveLength(2);
    expect(html).toMatch(/<rect class="franki-chip-stitch"[^>]*stroke="var\(--color-stitch\)"[^>]*stroke-dasharray="5 4"/);
    expect(html).toContain("border-brass");
  });

  it("chips are glass capsules with a brass edge and the 44 px target", () => {
    const html = renderToStaticMarkup(<Chips chips={CHIPS} disabled={false} onChip={() => {}} />);
    for (const button of html.match(/<button[^>]*>/g) ?? []) {
      for (const k of ["mat-glass", "franki-chip", "border-brass!", "min-h-11", "focus-visible:outline-2"]) expect(button).toContain(k);
    }
    expect(html).toMatch(/<span aria-hidden="true" data-stitch="" class="pointer-events-none/);
  });

  it("chips enter one after another on the stagger", () => {
    const html = renderToStaticMarkup(<Chips chips={CHIPS} disabled={false} onChip={() => {}} />);
    expect(html).toContain('<li class="franki-chip-enter" style="--chip:0">');
    expect(html).toContain('<li class="franki-chip-enter" style="--chip:1">');
    expect(css).toMatch(/\.franki-chip-enter \{\s*animation: franki-chip-in [^;]*;\s*animation-delay: calc\(var\(--stagger\) \* var\(--chip, 0\)\);/);
  });

  it("press settles 3% smaller, stitches run on hover and focus, and none of it moves under reduced motion", () => {
    const motionBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  .franki-chip-enter"));
    expect(motionBlock).toMatch(/\.franki-chip:not\(:disabled\):active \{ transform: scale\(0\.97\); \}/);
    expect(css).toMatch(/\.franki-chip \{\s*transition:\s*transform var\(--dur-base\) var\(--franki-spring-press\)/);
    expect(css).toMatch(/franki-stitch-run var\(--dur-base\) linear infinite/);
    expect(css).toContain('[data-reduced="true"] .franki-chip .franki-chip-stitch { animation: none !important; }');
    expect(css).toContain('[data-reduced="true"] .franki-chip:active { transform: none; }');
    expect(css).toMatch(/\[data-paused="true"\] \.franki-chip-stitch/);
    // Every running-stitch rule sits inside a no-preference block.
    const runs = [...css.matchAll(/animation: franki-stitch-run/g)].map((m) => m.index ?? 0);
    for (const at of runs) expect(css.lastIndexOf("@media (prefers-reduced-motion: no-preference)", at)).toBeGreaterThan(-1);
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
