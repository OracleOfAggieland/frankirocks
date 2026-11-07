import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { KnownItem, WhatIKnowProps } from "../../ui/surface-props";
import { WhatIKnowSheet } from "./WhatIKnowSheet";

const items: KnownItem[] = [
  { id: "g1", area: "Goals", text: "Run a 10k", from: "Call on Tue", guessed: false, hardRule: false },
  { id: "m1", area: "Money", text: "Saving for a bike", from: "Call on Mon", guessed: true, hardRule: false },
  { id: "r1", area: "Food and health", text: "Sam: no peanuts", from: "You said so", guessed: false, hardRule: true },
  { id: "t1", area: "Time and work", text: "Meetings after 6 on Thursdays", from: "Calendar", guessed: false, hardRule: false },
];
const props = (patch: Partial<WhatIKnowProps> = {}): WhatIKnowProps => ({ items, onWrong: () => {}, onForget: () => {}, onQuiet: () => {}, onClose: () => {}, ...patch });

function findButton(el: unknown, item: string, action: string): (() => void) | null {
  if (el === null || typeof el !== "object") return null;
  if (Array.isArray(el)) {
    for (const c of el) {
      const f = findButton(c, item, action);
      if (f) return f;
    }
    return null;
  }
  const node = el as { type: unknown; props: Record<string, unknown> };
  if (typeof node.type === "function") {
    const props = node.props as { item?: KnownItem };
    if (props.item && props.item.id !== item) return null;
    return findButton((node.type as (p: unknown) => unknown)(node.props), item, action);
  }
  if (node.props?.["data-action"] === action) return node.props.onClick as () => void;
  return findButton(node.props?.children, item, action);
}

describe("What_I_Know_Sheet", () => {
  it("puts hard rules first, then the areas in order", () => {
    const html = renderToStaticMarkup(<WhatIKnowSheet {...props()} />);
    const at = (s: string) => html.indexOf(`data-group="${s}"`);
    expect(at("rules")).toBeGreaterThan(-1);
    expect(at("rules")).toBeLessThan(at("Time and work"));
    expect(at("Time and work")).toBeLessThan(at("Money"));
    expect(at("Money")).toBeLessThan(at("Goals"));
    expect(html).not.toContain('data-group="People"');
    expect(html).toContain('aria-label="Locked rule"');
  });

  it("labels guesses with a dashed outline and shows text, origin and three actions", () => {
    const html = renderToStaticMarkup(<WhatIKnowSheet {...props()} />);
    expect(html).toMatch(/data-item="m1" data-guessed="true" class="[^"]*border-dashed/);
    expect(html).toContain(">Guessed<");
    expect(html).toContain("From Call on Mon");
    expect(html.match(/>Wrong</g)).toHaveLength(4);
    expect(html.match(/>Forget</g)).toHaveLength(4);
    expect(html.match(/>Don&#x27;t bring it up</g)).toHaveLength(4);
  });

  it("calls each action with the item ID", () => {
    const onWrong = vi.fn();
    const onForget = vi.fn();
    const onQuiet = vi.fn();
    const tree = WhatIKnowSheet(props({ onWrong, onForget, onQuiet }));
    findButton(tree, "m1", "wrong")!();
    findButton(tree, "g1", "forget")!();
    findButton(tree, "r1", "quiet")!();
    expect(onWrong).toHaveBeenCalledWith("m1");
    expect(onForget).toHaveBeenCalledWith("g1");
    expect(onQuiet).toHaveBeenCalledWith("r1");
  });

  it("renders nothing with no items", () => {
    expect(renderToStaticMarkup(<WhatIKnowSheet {...props({ items: [] })} />)).toBe("");
  });
});
