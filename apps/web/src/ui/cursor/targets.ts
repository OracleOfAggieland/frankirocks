// What the pointer is over, for the lab spider. Pure: it takes anything with `closest` and `matches`,
// so it runs on a real element in the browser and on a fake in a test. Called from pointer events only.

/** Things you can touch. An anchor counts only when it links somewhere. */
export const TOUCH_SELECTOR = [
  "a[href]",
  "button",
  "summary",
  "label",
  "select",
  "[role=button]",
  "[role=switch]",
  "[role=link]",
  "[role=radio]",
  "[role=checkbox]",
  "input[type=checkbox]",
  "input[type=radio]",
  "input[type=button]",
  "input[type=submit]",
  "input[type=reset]",
  "[data-touch]",
].join(",");

/** Text fields: the native text cursor shows here. Kept in step with the rule in components/cursor/cursor.css. */
export const TEXT_SELECTOR = [
  "input:not([type])",
  "input[type=text]",
  "input[type=search]",
  "input[type=email]",
  "input[type=url]",
  "input[type=tel]",
  "input[type=password]",
  "input[type=number]",
  "textarea",
  "[contenteditable]:not([contenteditable=false])",
].join(",");

/** Layers drawn above every z-index (a modal dialog, an open popover): the spider steps away there. */
export const TOP_LAYER_SELECTOR = ":modal, :popover-open";
/** The same, for a browser that doesn't know those selectors. */
export const TOP_LAYER_FALLBACK = "dialog[open]";

export interface ElementLike {
  closest(selector: string): ElementLike | null;
  matches(selector: string): boolean;
  getAttribute(name: string): string | null;
}

export type Over = "none" | "touch" | "text" | "away";

function closestSafe(el: ElementLike, selector: string, fallback: string): ElementLike | null {
  try {
    return el.closest(selector);
  } catch {
    return el.closest(fallback);
  }
}

const disabled = (el: ElementLike): boolean => el.matches(":disabled") || el.getAttribute("aria-disabled") === "true";

export function classify(target: ElementLike | null): Over {
  if (target === null) return "none";
  if (closestSafe(target, TOP_LAYER_SELECTOR, TOP_LAYER_FALLBACK) !== null) return "away";
  const field = target.closest(TEXT_SELECTOR);
  if (field !== null && !disabled(field)) return "text";
  const touchable = target.closest(TOUCH_SELECTOR);
  if (touchable !== null && !disabled(touchable)) return "touch";
  return "none";
}
