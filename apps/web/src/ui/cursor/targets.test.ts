import { describe, expect, it } from "vitest";
import { SPIDER_KEY, type StorageLike, readSpiderOn, writeSpiderOn } from "./preference";
import { type ElementLike, TEXT_SELECTOR, TOP_LAYER_FALLBACK, TOP_LAYER_SELECTOR, TOUCH_SELECTOR, classify } from "./targets";

/** A fake element: it answers `closest` for the selectors it was told it matches, itself or an ancestor. */
function fake(opts: { touch?: boolean; text?: boolean; topLayer?: boolean; disabled?: boolean; ariaDisabled?: boolean; oldBrowser?: boolean }): ElementLike {
  const self: ElementLike = {
    closest(selector) {
      if (selector === TOP_LAYER_SELECTOR && opts.oldBrowser) throw new SyntaxError("unknown pseudo-class");
      if (selector === TOP_LAYER_SELECTOR || selector === TOP_LAYER_FALLBACK) return opts.topLayer ? self : null;
      if (selector === TEXT_SELECTOR) return opts.text ? self : null;
      if (selector === TOUCH_SELECTOR) return opts.touch ? self : null;
      return null;
    },
    matches: (selector) => selector === ":disabled" && Boolean(opts.disabled),
    getAttribute: (name) => (name === "aria-disabled" && opts.ariaDisabled ? "true" : null),
  };
  return self;
}

describe("what the spider is over", () => {
  it("names touchable things, text fields, plain ground and top layers", () => {
    expect(classify(null)).toBe("none");
    expect(classify(fake({}))).toBe("none");
    expect(classify(fake({ touch: true }))).toBe("touch");
    expect(classify(fake({ text: true }))).toBe("text");
    expect(classify(fake({ text: true, touch: true }))).toBe("text");
    expect(classify(fake({ touch: true, topLayer: true }))).toBe("away");
  });

  it("disabled controls are not touchable", () => {
    expect(classify(fake({ touch: true, disabled: true }))).toBe("none");
    expect(classify(fake({ touch: true, ariaDisabled: true }))).toBe("none");
    expect(classify(fake({ text: true, disabled: true }))).toBe("none");
  });

  it("falls back when the browser doesn't know the top-layer selectors", () => {
    expect(classify(fake({ touch: true, oldBrowser: true }))).toBe("touch");
    expect(classify(fake({ touch: true, oldBrowser: true, topLayer: true }))).toBe("away");
  });

  it("covers the controls the brief lists", () => {
    for (const s of ["a[href]", "button", "summary", "label", "select", "[role=button]", "[role=switch]", "[role=link]", "[role=radio]", "input[type=checkbox]", "input[type=radio]", "[data-touch]"]) {
      expect(TOUCH_SELECTOR.split(",")).toContain(s);
    }
    for (const s of ["textarea", "input[type=text]", "[contenteditable]:not([contenteditable=false])"]) expect(TEXT_SELECTOR.split(",")).toContain(s);
  });
});

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const broken: StorageLike = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

describe("spider preference", () => {
  it("defaults to on when missing, without storage, or when storage throws", () => {
    expect(readSpiderOn(memory())).toBe(true);
    expect(readSpiderOn(null)).toBe(true);
    expect(readSpiderOn(broken)).toBe(true);
    expect(() => writeSpiderOn(false, broken)).not.toThrow();
  });

  it("remembers off and on", () => {
    const s = memory();
    writeSpiderOn(false, s);
    expect(s.data.get(SPIDER_KEY)).toBe("off");
    expect(readSpiderOn(s)).toBe(false);
    writeSpiderOn(true, s);
    expect(readSpiderOn(s)).toBe(true);
  });
});
