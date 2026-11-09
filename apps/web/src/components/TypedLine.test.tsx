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
