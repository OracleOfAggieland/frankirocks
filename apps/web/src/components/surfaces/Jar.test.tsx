import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MoteKind } from "../../ui/surface-props";
import { JAR_CAP, Jar } from "./Jar";

const motes = (n: number, kind: MoteKind = "told") => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, kind }));

describe("Jar", () => {
  it("draws one mote per memory up to the cap of 48", () => {
    expect(renderToStaticMarkup(<Jar motes={motes(5)} onOpen={() => {}} />).match(/data-mote=/g)).toHaveLength(5);
    expect(renderToStaticMarkup(<Jar motes={motes(80)} onOpen={() => {}} />).match(/data-mote=/g)).toHaveLength(JAR_CAP);
    expect(JAR_CAP).toBe(48);
  });

  it("codes motes by kind: solid, dashed, brass and frosted", () => {
    const html = renderToStaticMarkup(
      <Jar motes={[{ id: "a", kind: "told" }, { id: "b", kind: "guessed" }, { id: "c", kind: "rule" }, { id: "d", kind: "private" }]} onOpen={() => {}} />,
    );
    expect(html).toMatch(/data-mote="told"[^>]*fill="var\(--color-ecto\)"/);
    expect(html).toMatch(/data-mote="guessed"[^>]*fill="none"[^>]*stroke-dasharray/);
    expect(html).toMatch(/data-mote="rule"[^>]*fill="var\(--color-brass\)"/);
    expect(html).toMatch(/data-mote="private"[^>]*opacity="0.35"/);
  });

  it("is a button named What I know that calls onOpen", () => {
    const onOpen = vi.fn();
    const el = Jar({ motes: motes(1), onOpen });
    expect(renderToStaticMarkup(<Jar motes={motes(1)} onOpen={onOpen} />)).toContain('aria-label="What I know"');
    (el as { props: { onClick: () => void } }).props.onClick();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders nothing with no motes", () => {
    expect(renderToStaticMarkup(<Jar motes={[]} onOpen={() => {}} />)).toBe("");
  });
});
