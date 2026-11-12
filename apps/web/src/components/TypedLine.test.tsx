import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TypedLine, TypedLineCollapsed, TypedLineField, typedKeyAction } from "./TypedLine";

const field = { text: "", enabled: true, sending: false, canSend: true, error: null, onChange: () => {}, onSubmit: () => {} };

describe("TypedLine", () => {
  it("is collapsed to a keyboard glyph button by default", () => {
    const html = renderToStaticMarkup(<TypedLine {...field} />);
    expect(html).toContain('data-typed-line="collapsed"');
    expect(html).toContain('aria-label="Type to Franki"');
    expect(html).toContain("<svg");
    expect(html).not.toContain("<textarea");
  });

  it("opens to a one-row line", () => {
    const html = renderToStaticMarkup(<TypedLine {...field} defaultOpen />);
    expect(html).toContain('data-typed-line="open"');
    expect(html).toMatch(/<textarea[^>]*rows="1"/);
    const onOpen = vi.fn();
    (TypedLineCollapsed({ enabled: true, onOpen }) as { props: { onClick: () => void } }).props.onClick();
    expect(onOpen).toHaveBeenCalled();
  });

  it("stays collapsed and disabled while signed out", () => {
    const html = renderToStaticMarkup(<TypedLine {...field} enabled={false} defaultOpen />);
    expect(html).toContain('data-typed-line="collapsed"');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it("Enter sends, Shift+Enter keeps a line feed, IME composition is respected", () => {
    expect(typedKeyAction({ key: "Enter", shiftKey: false, isComposing: false }, "hi", false)).toBe("send");
    expect(typedKeyAction({ key: "Enter", shiftKey: false, isComposing: false }, "hi", true)).toBe("none");
    expect(typedKeyAction({ key: "Enter", shiftKey: true, isComposing: false }, "hi", false)).toBe("newline");
    expect(typedKeyAction({ key: "Enter", shiftKey: false, isComposing: true }, "hi", false)).toBe("none");
  });

  it("Escape collapses only when empty", () => {
    expect(typedKeyAction({ key: "Escape", shiftKey: false, isComposing: false }, "", false)).toBe("collapse");
    expect(typedKeyAction({ key: "Escape", shiftKey: false, isComposing: false }, "draft", false)).toBe("none");
  });

  it("keeps line feeds in pasted text", () => {
    const onChange = vi.fn();
    const form = TypedLineField({ ...field, onChange, onCollapse: () => {} }) as { props: { children: { props: { children: { props: { onChange: (e: unknown) => void } }[] } }[] } };
    const textarea = form.props.children[0].props.children[0];
    textarea.props.onChange({ target: { value: "line one\nline two" } });
    expect(onChange).toHaveBeenCalledWith("line one\nline two");
  });

  it("the key handler sends on Enter and collapses on Escape", () => {
    const onSubmit = vi.fn();
    const onCollapse = vi.fn();
    const form = TypedLineField({ ...field, text: "", onSubmit, onCollapse }) as { props: { children: { props: { children: { props: { onKeyDown: (e: unknown) => void } }[] } }[] } };
    const keydown = form.props.children[0].props.children[0].props.onKeyDown;
    const ev = (key: string, shiftKey = false, isComposing = false) => ({ key, shiftKey, nativeEvent: { isComposing }, preventDefault: vi.fn() });
    keydown(ev("Escape"));
    expect(onCollapse).toHaveBeenCalledTimes(1);
    const enter = ev("Enter");
    keydown(enter);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(enter.preventDefault).toHaveBeenCalled();
    const shiftEnter = ev("Enter", true);
    keydown(shiftEnter);
    expect(shiftEnter.preventDefault).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("TypedLine looks (brief 015)", () => {
  it("collapsed, the keyboard glyph is quiet: no edge", () => {
    const html = renderToStaticMarkup(<TypedLine {...field} />);
    const tag = /<button[^>]*data-typed-line="collapsed"[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toContain("text-ink-dim");
    expect(tag).not.toMatch(/(^|\s)border(\s|-)/);
  });

  it("open, it is one glass capsule with a stitched inner outline and a brass Send, and it materializes", () => {
    const html = renderToStaticMarkup(<TypedLine {...field} defaultOpen />);
    expect(html.match(/data-typed-capsule=""/g)).toHaveLength(1);
    expect(html).toMatch(/data-typed-capsule="" class="[^"]*\bmat-glass\b[^"]*\bfranki-materialize\b[^"]*\brounded-chip\b/);
    expect(html).toMatch(/data-stitch-outline=""[^>]*class="[^"]*border-dashed border-stitch/);
    expect(html).toMatch(/aria-hidden="true" data-stitch-outline/);
    expect(html).toMatch(/<button type="submit"[^>]*class="[^"]*\bmat-brass\b[^"]*"[^>]*>Send</);
    // The capsule draws the focus ring for its field.
    expect(html).toMatch(/data-typed-capsule="" class="[^"]*has-\[textarea:focus-visible\]:outline-brass-hi/);
  });
});

// Brief 018 task B10 (brief 012 G34): a paste event in the line is reported, so the line goes as pasted.
describe("TypedLine paste", () => {
  type El = { type?: unknown; props?: { children?: unknown; onPaste?: () => void } };
  const find = (node: unknown, type: string): El | null => {
    if (node === null || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const f = find(n, type);
        if (f !== null) return f;
      }
      return null;
    }
    const el = node as El;
    if (el.type === type) return el;
    return find(el.props?.children, type);
  };

  it("reports a paste event from the textarea", () => {
    const onPaste = vi.fn();
    const tree = TypedLineField({ ...field, onPaste, onCollapse: () => {} });
    find(tree, "textarea")!.props!.onPaste!();
    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it("a paste with no listener does nothing", () => {
    const tree = TypedLineField({ ...field, onCollapse: () => {} });
    expect(() => find(tree, "textarea")!.props!.onPaste!()).not.toThrow();
  });
});
