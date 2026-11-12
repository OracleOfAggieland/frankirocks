import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY } from "../../ui/copy";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import { ForgetLast, ForgetLastButton, type ForgetLastProps } from "./ForgetLast";

// The button asks motion whether it is still present (it is not during its exit). Calling it as a plain
// function needs that hook to answer without a renderer; the answer is switchable to test the exit.
const m = vi.hoisted(() => ({ present: true }));
vi.mock("motion/react", async (actual) => ({
  ...(await actual<typeof import("motion/react")>()),
  useIsPresent: () => m.present,
}));

const render = (p: Partial<ForgetLastProps>) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced>
      <ForgetLast available onForget={() => {}} {...p} />
    </ReducedMotionOverride>,
  );

const button = (html: string) => /<button[^>]*>/.exec(html)?.[0] ?? "";

type El = { type?: unknown; props: { children?: unknown; onClick?: () => void; "aria-disabled"?: unknown } };
/** The button element that ForgetLastButton returns, reached by calling the components as functions. */
const buttonEl = (p: { pending?: boolean; onForget: () => void }): El | null => {
  const outer = ForgetLast({ available: true, ...p }) as unknown as El;
  const inner = outer.props.children as El;
  expect(inner.type).toBe(ForgetLastButton);
  const span = ForgetLastButton(inner.props as Parameters<typeof ForgetLastButton>[0]) as unknown as El;
  const kids = span.props.children as El[];
  return kids.find((k) => k?.type === "button") ?? null;
};

describe("ForgetLast", () => {
  afterEach(() => {
    m.present = true;
  });

  it("renders nothing when there is nothing to forget", () => {
    expect(render({ available: false })).toBe("");
    expect(render({ available: false, pending: true })).toBe("");
  });

  it("is a quiet capsule reading Forget last thing, with a mote glyph", () => {
    const html = render({});
    const b = button(html);
    expect(b).toContain("rounded-chip");
    expect(b).toContain("border-ink-dim");
    expect(b).not.toContain("mat-brass");
    expect(b).toContain("min-h-11");
    expect(b).toContain("focus-visible:outline-2");
    expect(b).not.toContain('disabled=""');
    expect(b).not.toContain("aria-disabled=");
    expect(b).toContain("not-aria-disabled:hover:bg-night-2");
    expect(html).toContain(`${COPY.forgetLast}</button>`);
    expect(html).toMatch(/<svg data-glyph="mote"[^>]*aria-hidden="true"/);
    expect(html).not.toContain("data-lamp");
  });

  it("while pending: disabled, busy, a lit lamp in place of the glyph, and a status word", () => {
    const html = render({ pending: true });
    const b = button(html);
    // aria-disabled rather than disabled, so the button keeps keyboard focus while it is pending.
    expect(b).toContain('aria-disabled="true"');
    expect(b).not.toContain('disabled=""');
    expect(b).toContain('aria-busy="true"');
    expect(html).toContain('data-forget-last="pending"');
    expect(html).toContain('data-lamp="on"');
    expect(html).not.toContain('data-glyph="mote"');
    expect(html).toContain('<span role="status" class="sr-only">Forgetting</span>');
  });

  it("the status region is present but empty when not pending", () => {
    expect(render({})).toContain('<span role="status" class="sr-only"></span>');
  });

  it("calls onForget on click", () => {
    const onForget = vi.fn();
    const html = renderToStaticMarkup(<ForgetLast available onForget={onForget} />);
    expect(html).toContain(COPY.forgetLast);
    buttonEl({ onForget })?.props.onClick?.();
    expect(onForget).toHaveBeenCalledTimes(1);
  });

  it("ignores presses while pending and while it is leaving", () => {
    const onForget = vi.fn();
    const pending = buttonEl({ pending: true, onForget });
    expect(pending?.props.onClick).toBeUndefined();
    expect(pending?.props["aria-disabled"]).toBe(true);
    m.present = false;
    const leaving = buttonEl({ onForget });
    expect(leaving?.props.onClick).toBeUndefined();
    expect(leaving?.props["aria-disabled"]).toBe(true);
    expect(onForget).not.toHaveBeenCalled();
  });

  it("the mote's hover drift is gated on aria-disabled, not on :enabled", () => {
    const css = readFileSync(join(import.meta.dirname, "controls.css"), "utf8");
    expect(css).not.toContain(".franki-forget:enabled");
    expect(css).toContain('.franki-forget:not([aria-disabled="true"]):hover .franki-mote-bit');
  });

  it("its loop runs only with motion allowed, stops when reduced and pauses when hidden", () => {
    const css = readFileSync(join(import.meta.dirname, "controls.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.franki-forget-lamp \{ animation:/);
    expect(css).toMatch(/\[data-reduced="true"\] \.franki-forget-lamp \{\s*animation: none;/);
    expect(css).toMatch(/\[data-paused="true"\] \.franki-forget-lamp \{\s*animation-play-state: paused;/);
  });
});
