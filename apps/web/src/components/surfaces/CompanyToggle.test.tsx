import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY } from "../../ui/copy";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import { SPRING } from "../../ui/motion";
import { CompanyToggle, type CompanyToggleProps } from "./CompanyToggle";

// The component reads Reduced_Motion through a hook; calling it as a plain function (to reach onClick)
// needs the hook to answer without a renderer. The answer is switchable so the press can be tested.
const m = vi.hoisted(() => ({ reduced: true }));
vi.mock("../../ui/hooks/reduced-motion", async (actual) => ({
  ...(await actual<typeof import("../../ui/hooks/reduced-motion")>()),
  useReducedMotion: () => m.reduced,
}));

const render = (p: Partial<CompanyToggleProps>) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced>
      <CompanyToggle company={false} onChange={() => {}} {...p} />
    </ReducedMotionOverride>,
  );

const button = (html: string) => /<button[^>]*>/.exec(html)?.[0] ?? "";
/** The visible label: the text of the layer that is not the width keeper. */
const visible = (html: string) => html.replace(/<span aria-hidden="true" data-width-keeper=""[\s\S]*?<\/span><\/span>/, "");

type El = { props: { whileTap?: unknown; transition?: Record<string, unknown>; onClick: () => void } };
const element = (p: Partial<CompanyToggleProps>) => CompanyToggle({ company: false, onChange: () => {}, ...p }) as unknown as El;

describe("CompanyToggle", () => {
  afterEach(() => {
    m.reduced = true;
  });

  it("is a switch with its state in aria-checked, a 44 px target and a focus ring", () => {
    for (const company of [false, true]) {
      const b = button(render({ company }));
      expect(b).toContain('role="switch"');
      expect(b).toContain(`aria-checked="${company}"`);
      expect(b).toContain("min-h-11");
      expect(b).toContain("focus-visible:outline-2");
    }
  });

  it("its name always carries the state: Company mode, then the visible label", () => {
    expect(button(render({ company: false }))).toContain('aria-label="Company mode: Someone walked in"');
    expect(button(render({ company: true }))).toContain('aria-label="Company mode: We&#x27;re alone"');
  });

  it("off: a brass-edged capsule with a door glyph, reading Someone walked in", () => {
    const html = render({ company: false });
    expect(button(html)).toContain('data-company="off"');
    expect(button(html)).toContain("mat-glass");
    expect(button(html)).toContain("border-brass!");
    expect(button(html)).toContain("rounded-chip");
    expect(button(html)).not.toContain("backdrop-blur-sm");
    expect(html).toContain('data-brass-fill="off"');
    expect(html).toMatch(/mat-brass[^"]*opacity-0/);
    expect(html).toContain('data-glyph="door"');
    expect(html).not.toContain('data-glyph="curtain"');
    expect(visible(html)).toContain(COPY.company.walkedIn);
    expect(visible(html)).not.toContain(COPY.company.alone);
  });

  it("on: filled brass with a drawn curtain glyph, reading We're alone", () => {
    const html = render({ company: true });
    expect(button(html)).toContain('data-company="on"');
    expect(button(html)).toContain("text-night-0");
    expect(html).toContain('data-brass-fill="on"');
    expect(html).toMatch(/mat-brass[^"]*opacity-100/);
    expect(html).toContain('data-glyph="curtain"');
    expect(html).not.toContain('data-glyph="door"');
    const v = visible(html);
    expect(v).toContain(COPY.company.alone.replace("'", "&#x27;"));
    expect(v).not.toContain(COPY.company.walkedIn);
  });

  it("keeps its width: the other label is held invisible and hidden from assistive tech", () => {
    const html = render({ company: true });
    expect(html).toMatch(/<span aria-hidden="true" data-width-keeper="" class="invisible [^"]*">.*Someone walked in<\/span>/);
  });

  it("glyphs are decorative", () => {
    for (const company of [false, true]) {
      expect(render({ company })).toMatch(/<svg data-glyph="(door|curtain)"[^>]*aria-hidden="true"/);
    }
  });

  it("asks for the other state on click", () => {
    const onChange = vi.fn();
    element({ company: false, onChange }).props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(true);
    element({ company: true, onChange }).props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("can be disabled, and a disabled toggle does not light up on hover", () => {
    expect(button(render({ disabled: true }))).toContain('disabled=""');
    expect(button(render({}))).not.toContain('disabled=""');
    expect(button(render({}))).toMatch(/ enabled:hover:bg-/);
    expect(button(render({}))).not.toMatch(/ hover:bg-/);
  });

  it("presses 2 px on spring.press with motion allowed; no press when disabled or reduced", () => {
    m.reduced = false;
    expect(element({}).props.whileTap).toEqual({ y: 2 });
    expect(element({}).props.transition).toMatchObject({ type: "spring", ...SPRING.press });
    expect(element({ disabled: true }).props.whileTap).toBeUndefined();
    m.reduced = true;
    expect(element({}).props.whileTap).toBeUndefined();
  });

  it("its glyph motion runs only with motion allowed; reduced is a fade with the curtains still", () => {
    const css = readFileSync(join(import.meta.dirname, "controls.css"), "utf8");
    // The first no-preference block is the toggle's; blocks end with a closing brace at the start of a line.
    const noPref = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(noPref).toMatch(/\.franki-curtain-l,\s*\.franki-curtain-r \{\s*animation: franki-curtain-draw/);
    expect(noPref).toMatch(/\.franki-control-in \{ animation: franki-control-in /);
    const outside = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/animation: franki-curtain-draw/);
    expect(outside).not.toMatch(/animation: franki-control-in /);
    expect(outside).toMatch(/\n\.franki-control-in \{\s*animation: franki-control-fade /);
    expect(css).toMatch(/\[data-reduced="true"\] \.franki-curtain-l,\s*\[data-reduced="true"\] \.franki-curtain-r \{\s*animation: none;/);
    expect(css).toMatch(/\[data-reduced="true"\] \.franki-control-in \{\s*animation: franki-control-fade /);
  });
});
