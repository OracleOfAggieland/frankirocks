import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { lookFor } from "../../ui/avatar/look";
import type { AvatarInput, AvatarRendererProps } from "../../ui/avatar/types";
import { Avatar } from "./Avatar";
import { Stage } from "./Stage";
import { SvgGhost } from "./SvgGhost";

const input: AvatarInput = {
  state: "thinking", micMuted: false, outputMuted: false, inputLevel: 0, outputLevel: 0,
  event: null, eventElapsedMs: 0, firstConnecting: false, reducedMotion: false,
};

describe("Avatar", () => {
  it("renders through the contract with role, label and data attributes", () => {
    const html = renderToStaticMarkup(<Avatar look={lookFor(input)} input={input} renderer={SvgGhost} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Franki is thinking"');
    expect(html).toContain('data-look="Thinking"');
    expect(html).toContain('data-ghost="false"');
    expect(html).toContain('data-reduced="false"');
    expect(html).toContain('data-renderer="svg-ghost"');
    expect(html.match(/role="img"/g)).toHaveLength(1);
  });

  it("swaps the renderer without changing the wrapper", () => {
    const Fake = ({ look }: AvatarRendererProps) => <span data-fake={look.name} />;
    const html = renderToStaticMarkup(<Avatar look={lookFor(input)} input={input} renderer={Fake} />);
    expect(html).toContain('data-fake="Thinking"');
    expect(html).toContain('aria-label="Franki is thinking"');
  });
});

describe("Stage", () => {
  it("has a halo and a floor that float only with Reduced_Motion off", () => {
    const moving = renderToStaticMarkup(<Stage reduced={false}>x</Stage>);
    const calm = renderToStaticMarkup(<Stage reduced>x</Stage>);
    expect(moving).toContain('data-part="halo"');
    expect(moving).toContain("franki-floor");
    expect(calm).toContain('data-part="floor"');
    expect(calm).not.toContain("franki-floor");
    expect(calm).not.toContain("franki-halo");
  });
});
