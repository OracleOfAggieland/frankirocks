import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { COPY } from "../../ui/copy";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import type { KnownItem, WhatIKnowProps } from "../../ui/surface-props";
import {
  FOCUSABLE,
  WhatIKnowSheet,
  type WhatIKnowSheetProps,
  WhatIKnowView,
  type WhatIKnowViewProps,
  closesOnForget,
  focusAfterForget,
  nextFocusIndex,
  ruleForgetBlur,
  ruleForgetPress,
  sheetOrder,
} from "./WhatIKnowSheet";

const items: KnownItem[] = [
  { id: "g1", area: "Goals", text: "Run a 10k", from: "Call on Tue", guessed: false, hardRule: false },
  { id: "m1", area: "Money", text: "Saving for a bike", from: "Call on Mon", guessed: true, hardRule: false },
  { id: "r1", area: "Food and health", text: "Sam: no peanuts", from: "You said so", guessed: false, hardRule: true },
  { id: "t1", area: "Time and work", text: "Meetings after 6 on Thursdays", from: "Calendar", guessed: false, hardRule: false },
];
const props = (patch: Partial<WhatIKnowProps> = {}): WhatIKnowProps => ({ items, onWrong: () => {}, onForget: () => {}, onQuiet: () => {}, onClose: () => {}, ...patch });
const view = (patch: Partial<WhatIKnowViewProps> = {}): WhatIKnowViewProps => ({
  ...props(),
  presentation: "inline",
  reduced: true,
  armed: null,
  onArm: () => {},
  onRuleBlur: () => {},
  ...patch,
});
const render = (p: Partial<WhatIKnowSheetProps> = {}, reduced = true) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced={reduced}>
      <WhatIKnowSheet {...props()} {...p} />
    </ReducedMotionOverride>,
  );

/**
 * Finds a handler on the element tree without rendering it: inside the item `item`, the element with
 * `data-action={action}`. Components that need a renderer (presence, motion) are walked through their
 * children rather than called; the sheet's view builds every item inline, so its buttons are reachable.
 */
function findHandler(el: unknown, item: string, action: string, handler = "onClick"): ((e?: unknown) => void) | null {
  if (el === null || typeof el !== "object") return null;
  if (Array.isArray(el)) {
    for (const c of el) {
      const f = findHandler(c, item, action, handler);
      if (f) return f;
    }
    return null;
  }
  const node = el as { props?: Record<string, unknown> };
  const p = node.props;
  if (!p) return null;
  if (typeof p["data-item"] === "string" && p["data-item"] !== item) return null;
  if (p["data-action"] === action) return (p[handler] as (e?: unknown) => void) ?? null;
  return findHandler(p.children, item, action, handler);
}
const findButton = (el: unknown, item: string, action: string) => findHandler(el, item, action);

describe("What_I_Know_Sheet", () => {
  it("puts hard rules first, then the areas in order", () => {
    const html = render();
    const at = (s: string) => html.indexOf(`data-group="${s}"`);
    expect(at("rules")).toBeGreaterThan(-1);
    expect(at("rules")).toBeLessThan(at("Time and work"));
    expect(at("Time and work")).toBeLessThan(at("Money"));
    expect(at("Money")).toBeLessThan(at("Goals"));
    expect(html).not.toContain('data-group="People"');
    expect(html).toContain('aria-label="Locked rule"');
    expect(sheetOrder(items)).toEqual(["r1", "t1", "m1", "g1"]);
  });

  it("labels guesses with a dashed outline and shows text, origin and three actions", () => {
    for (const reduced of [true, false]) {
      const html = render({}, reduced);
      expect(html).toMatch(/data-item="m1" data-guessed="true" class="[^"]*border-dashed/);
      expect(html).toContain(">Guessed<");
      expect(html).toContain("From Call on Mon");
      expect(html.match(/>Wrong</g)).toHaveLength(4);
      expect(html.match(/>Forget</g)).toHaveLength(4);
      expect(html.match(/>Don&#x27;t bring it up</g)).toHaveLength(4);
    }
  });

  // The view is the sheet's stateless drawing; the sheet itself holds hooks, so its handlers are reached through the view.
  it("calls each action with the item ID", () => {
    const onWrong = vi.fn();
    const onForget = vi.fn();
    const onQuiet = vi.fn();
    const tree = WhatIKnowView(view({ onWrong, onForget, onQuiet }));
    findButton(tree, "m1", "wrong")!();
    findButton(tree, "g1", "forget")!();
    findButton(tree, "r1", "quiet")!();
    expect(onWrong).toHaveBeenCalledWith("m1");
    expect(onForget).toHaveBeenCalledWith("g1");
    expect(onQuiet).toHaveBeenCalledWith("r1");
  });

  it("renders nothing with no items", () => {
    expect(renderToStaticMarkup(<WhatIKnowSheet {...props({ items: [] })} />)).toBe("");
    expect(renderToStaticMarkup(<WhatIKnowSheet {...props({ items: [] })} presentation="sheet" />)).toBe("");
  });
});

describe("What I know, brief 015", () => {
  it("defaults to the inline presentation, which is not modal", () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="What I know"');
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain("data-sheet-layer");
  });

  it("as a sheet is modal: a scrim, aria-modal, a drawer from 1024 px and a bottom sheet below", () => {
    const html = render({ presentation: "sheet" });
    expect(html).toContain("data-sheet-layer");
    expect(html).toMatch(/data-sheet-scrim=""[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-sheet-scrim=""/);
    const panel = /<section ([^>]*)>/.exec(html)![1];
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('aria-modal="true"');
    expect(panel).toContain('aria-label="What I know"');
    expect(panel).toContain("max-h-[80svh]");
    expect(panel).toContain("lg:max-w-[420px]");
    expect(panel).toContain("lg:right-0");
    expect(panel).toContain("lg:inset-y-0");
    // Below 1024 px the body scrolls inside the sheet.
    expect(html).toMatch(/data-sheet-body="" class="[^"]*overflow-y-auto/);
    // The heading takes focus on open, so it is focusable by script but not a Tab stop.
    expect(html).toMatch(/<h2 tabindex="-1"[^>]*>What I know<\/h2>/);
  });

  it("gives each group a line glyph and a seam, and the rules group the seal", () => {
    const html = render();
    for (const group of ["Time and work", "Money", "Goals"]) {
      const block = new RegExp(`data-group="${group}"[^>]*>([\\s\\S]*?)<ul`).exec(html)![1];
      expect(block).toContain("data-glyph");
      expect(block).toContain("data-seam");
    }
    const rules = /data-group="rules"[^>]*>([\s\S]*?)<ul/.exec(html)![1];
    expect(rules).toContain("data-seal");
    expect(rules).toContain("data-seam");
  });

  it("draws each item as a tag: text in 16, From in mono 12", () => {
    const html = render();
    expect(html).toMatch(/<p class="[^"]*text-base text-ink">Run a 10k<\/p>/);
    expect(html).toMatch(/<p class="font-mono text-xs text-ink-dim">From Call on Tue<\/p>/);
  });

  it("asks for a second tap before forgetting a hard rule", () => {
    const onForget = vi.fn();
    const onArm = vi.fn();
    const first = WhatIKnowView(view({ onForget, onArm }));
    findButton(first, "r1", "forget")!();
    expect(onArm).toHaveBeenCalledWith("r1");
    expect(onForget).not.toHaveBeenCalled();

    const armed = WhatIKnowView(view({ onForget, onArm, armed: "r1" }));
    findButton(armed, "r1", "forget")!();
    expect(onForget).toHaveBeenCalledWith("r1");

    const html = renderToStaticMarkup(<WhatIKnowView {...view({ armed: "r1" })} />);
    expect(html).toContain(`>${COPY.sheet.confirmRule}<`);
    expect(html.match(/>Forget</g)).toHaveLength(3);
    expect(html).toContain('data-armed="true"');
  });

  it("disarms the rule when its button loses focus", () => {
    const onRuleBlur = vi.fn();
    const tree = WhatIKnowView(view({ armed: "r1", onRuleBlur }));
    findHandler(tree, "r1", "forget", "onBlur")!();
    expect(onRuleBlur).toHaveBeenCalledWith("r1");
    // Ordinary items forget on the first tap and have no blur rule.
    expect(findHandler(tree, "g1", "forget", "onBlur")).toBeNull();
  });

  it("moves focus on before a forget goes out", () => {
    const onBeforeForget = vi.fn();
    const onForget = vi.fn();
    const tree = WhatIKnowView(view({ onBeforeForget, onForget }));
    findButton(tree, "t1", "forget")!();
    expect(onBeforeForget).toHaveBeenCalledWith("t1", null);
    expect(onForget).toHaveBeenCalledWith("t1");
  });

  it("dematerializes items as they leave, and fades under reduced motion", () => {
    const tree = WhatIKnowView(view({ reduced: false }));
    const found: { exit?: unknown; variants?: Record<string, Record<string, unknown>> }[] = [];
    const walk = (el: unknown): void => {
      if (el === null || typeof el !== "object") return;
      if (Array.isArray(el)) return el.forEach(walk);
      const p = (el as { props?: Record<string, unknown> }).props;
      if (!p) return;
      if (typeof p["data-item"] === "string") found.push(p as never);
      walk(p.children);
    };
    walk(tree);
    expect(found).toHaveLength(4);
    for (const f of found) {
      expect(f.exit).toBe("gone");
      expect(f.variants!.gone).toMatchObject({ opacity: 0, y: -8, filter: "blur(6px)" });
    }
    found.length = 0;
    walk(WhatIKnowView(view({ reduced: true })));
    for (const f of found) expect(f.variants!.gone).toEqual({ opacity: 0 });
  });
});

describe("What I know, pure rules", () => {
  it("arms on the first press, forgets on the second, and disarms on blur", () => {
    expect(ruleForgetPress(null, "r1")).toEqual({ armed: "r1", forget: false });
    expect(ruleForgetPress("r1", "r1")).toEqual({ armed: null, forget: true });
    expect(ruleForgetPress("r2", "r1")).toEqual({ armed: "r1", forget: false });
    expect(ruleForgetBlur("r1", "r1")).toBeNull();
    expect(ruleForgetBlur("r2", "r1")).toBe("r2");
  });

  it("never forgets a rule on a single press from rest, whatever was armed before", () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), fc.string(), (armed, id) => {
        fc.pre(armed !== id);
        expect(ruleForgetPress(armed, id).forget).toBe(false);
        expect(ruleForgetPress(ruleForgetPress(armed, id).armed, id).forget).toBe(true);
      }),
    );
  });

  it("hands focus to the next item, else the one before, else the heading", () => {
    expect(focusAfterForget(["a", "b", "c"], "a")).toBe("b");
    expect(focusAfterForget(["a", "b", "c"], "c")).toBe("b");
    expect(focusAfterForget(["a"], "a")).toBeNull();
    expect(focusAfterForget(["a", "b"], "x")).toBeNull();
    fc.assert(
      fc.property(fc.uniqueArray(fc.string(), { minLength: 1 }), fc.nat(), (order, k) => {
        const id = order[k % order.length];
        const next = focusAfterForget(order, id);
        if (order.length === 1) expect(next).toBeNull();
        else {
          expect(next).not.toBe(id);
          expect(order).toContain(next);
        }
      }),
    );
  });

  it("keeps Tab inside the sheet, wrapping at both ends", () => {
    expect(nextFocusIndex({ count: 0, current: -1, shift: false })).toBe(-1);
    expect(nextFocusIndex({ count: 3, current: -1, shift: false })).toBe(0);
    expect(nextFocusIndex({ count: 3, current: -1, shift: true })).toBe(2);
    expect(nextFocusIndex({ count: 3, current: 2, shift: false })).toBe(0);
    expect(nextFocusIndex({ count: 3, current: 0, shift: true })).toBe(2);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.integer({ min: -1, max: 70 }), fc.boolean(), (count, current, shift) => {
        const next = nextFocusIndex({ count, current, shift });
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(count);
        // From any control, Tab then Shift+Tab comes back to it.
        if (current >= 0 && current < count) expect(nextFocusIndex({ count, current: nextFocusIndex({ count, current, shift }), shift: !shift })).toBe(current);
      }),
    );
    // Tabbing forward from the heading visits every control once before wrapping.
    const seen: number[] = [];
    let at = -1;
    for (let k = 0; k < 5; k++) seen.push((at = nextFocusIndex({ count: 5, current: at, shift: false })));
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect(FOCUSABLE).toContain("button:not([disabled])");
  });
});

describe("What I know, brief 015 review", () => {
  it("gives a hard rule's Forget one footprint: the other label sits unseen in the same cell", () => {
    const rest = renderToStaticMarkup(<WhatIKnowView {...view()} />);
    const armed = renderToStaticMarkup(<WhatIKnowView {...view({ armed: "r1" })} />);
    // Fix pass: the two labels are both short ("Forget" and "Tap again"), so the button is never wide.
    expect(rest).toContain(`aria-hidden="true" data-label="${COPY.sheet.armedRule}"`);
    expect(armed).toContain(`aria-hidden="true" data-label="${COPY.sheet.forget}"`);
    for (const html of [rest, armed]) expect(html).toMatch(/data-item="r1"[\s\S]*?data-action="forget"[^>]*class="inline-grid/);
    for (const html of [rest, armed]) expect(html).not.toContain(`data-label="${COPY.sheet.confirmRule}"`);
  });

  it("announces the second-tap warning while a rule is armed", () => {
    expect(renderToStaticMarkup(<WhatIKnowView {...view()} />)).toContain('<span role="status" data-rule-status="" class="sr-only"></span>');
    expect(renderToStaticMarkup(<WhatIKnowView {...view({ armed: "r1" })} />)).toContain(
      `<span role="status" data-rule-status="" class="sr-only">${COPY.sheet.confirmRule}</span>`,
    );
  });

  it("makes the sheet panel focusable by script, so a click inside keeps focus in it", () => {
    const panel = /<section ([^>]*)>/.exec(render({ presentation: "sheet" }))![1];
    expect(panel).toContain('tabindex="-1"');
  });

  it("arms a rule with a short label and spells the warning out in one line under the row", () => {
    const rest = renderToStaticMarkup(<WhatIKnowView {...view()} />);
    const armed = renderToStaticMarkup(<WhatIKnowView {...view({ armed: "r1" })} />);
    const rule = (html: string) => /data-item="r1"[\s\S]*?<\/li>/.exec(html)![0];
    // The armed button reads "Tap again"; the whole sentence sits under the action row.
    expect(rule(armed)).toMatch(/data-action="forget"[^>]*>[\s\S]*?<span class="col-start-1 row-start-1">Tap again<\/span>/);
    expect(rule(armed)).toMatch(new RegExp(`data-actions=""[\\s\\S]*?</div><p aria-hidden="true" data-rule-confirm="" class="[^"]*whitespace-nowrap[^"]*">[\\s\\S]*?${COPY.sheet.confirmRule}</p>`));
    expect(rest).not.toContain("data-rule-confirm");
    // Not colour alone: the armed button also gains a doubled edge (an inset ring, so no size change).
    expect(rule(armed)).toMatch(/data-action="forget" data-armed="true" class="[^"]*ring-inset ring-ember/);
    expect(rule(rest)).not.toContain("ring-ember");
    // Only one rule's line shows; the others stay at rest.
    expect(armed.match(/data-rule-confirm/g)).toHaveLength(1);
  });

  it("fits the three actions on one row from a 335 px sheet, by a container query on the sheet", () => {
    const inline = render();
    const modal = render({ presentation: "sheet" });
    // Both presentations are the container; the inline one has a set width, so it never sizes to its contents.
    expect(/<section ([^>]*)>/.exec(inline)![1]).toMatch(/class="[^"]*@container\/sheet[^"]*w-\[343px\] max-w-full[^"]*sm:w-md/);
    expect(/<section ([^>]*)>/.exec(modal)![1]).toContain("@container/sheet");
    for (const html of [inline, modal]) {
      const rows = html.match(/<div data-actions="" class="([^"]*)"/g)!;
      expect(rows).toHaveLength(4);
      for (const r of rows) expect(r).toContain("gap-1.5 @min-[25rem]/sheet:gap-2");
      // Narrow: 12 px labels with 6 px padding; from 400 px of sheet: 14 px with 12 px padding. Always a 44 px target.
      const buttons = html.match(/<button type="button" data-action="(wrong|forget|quiet)"[^>]*class="[^"]*"/g)!;
      expect(buttons).toHaveLength(12);
      for (const b of buttons) {
        expect(b).toContain("min-h-11 min-w-11");
        expect(b).toContain("px-1.5 text-xs @min-[25rem]/sheet:px-3 @min-[25rem]/sheet:text-sm");
        expect(b).not.toMatch(/ (px-3|text-sm) /);
      }
    }
    // The words themselves never change.
    expect([COPY.sheet.wrong, COPY.sheet.forget, COPY.sheet.quiet]).toEqual(["Wrong", "Forget", "Don't bring it up"]);
  });

  it("closes the sheet when its last item is forgotten, and not before", () => {
    expect(closesOnForget("sheet", ["a"], "a")).toBe(true);
    expect(closesOnForget("sheet", ["a", "b"], "a")).toBe(false);
    expect(closesOnForget("inline", ["a"], "a")).toBe(false);
    expect(closesOnForget("sheet", ["a"], "x")).toBe(false);
  });
});

describe("What_I_Know_Sheet on real data (brief 027)", () => {
  const unsorted: KnownItem[] = [
    { id: "u1", area: null, text: "Biscuit has surgery Thursday", from: "You said", guessed: false, hardRule: false },
    { id: "g2", area: "Goals", text: "Run a 10k", from: "You said", guessed: false, hardRule: false },
  ];

  it("puts items with no area last, under Other things", () => {
    expect(sheetOrder(unsorted)).toEqual(["g2", "u1"]);
    const html = render({ items: unsorted });
    expect(html).toContain('data-group="unsorted"');
    expect(html).toContain(COPY.sheetData.unsorted);
    expect(html.indexOf('data-group="Goals"')).toBeLessThan(html.indexOf('data-group="unsorted"'));
  });

  it("read-only shows each item and where it came from, with no actions", () => {
    const html = render({ items: unsorted, readOnly: true });
    expect(html).toContain("Biscuit has surgery Thursday");
    expect(html).toContain(`${COPY.sheet.from} You said`);
    expect(html).not.toContain("data-actions");
    expect(html).not.toContain('data-action="forget"');
    expect(render({ items: unsorted })).toContain('data-action="forget"');
  });

  it("draws its footer under the items", () => {
    const html = render({ items: unsorted, footer: <p data-test-footer="">slip</p> });
    expect(html).toContain("data-sheet-footer");
    expect(html.indexOf("data-test-footer")).toBeGreaterThan(html.indexOf("Biscuit"));
  });
});
