// The lab scenery's two browser subscriptions, kept apart from the component so they can be tested with
// fakes: the pointer (for the parallax) and the page layout (for the crop and Franki's slab).
import { type Box, type Point, parallaxUnit } from "./geometry";

export interface PointerLike {
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly relatedTarget: unknown;
}

export interface WindowLike {
  readonly innerWidth: number;
  readonly innerHeight: number;
  addEventListener(type: "pointermove" | "pointerout", listener: (e: PointerLike) => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: "pointermove" | "pointerout", listener: (e: PointerLike) => void): void;
}

/**
 * Follow a mouse or pen across the window and report the parallax unit for each move. Touch is ignored.
 * When the pointer leaves the window the unit goes back to 0, 0, so the room settles to centre.
 * Returns the cleanup, which removes both listeners.
 */
export function watchPointer(target: WindowLike, set: (unit: Point) => void): () => void {
  const onMove = (e: PointerLike) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    set(parallaxUnit(e.clientX, e.clientY, target.innerWidth, target.innerHeight));
  };
  const onOut = (e: PointerLike) => {
    if (e.relatedTarget !== null) return;
    set({ x: 0, y: 0 });
  };
  target.addEventListener("pointermove", onMove, { passive: true });
  target.addEventListener("pointerout", onOut, { passive: true });
  return () => {
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerout", onOut);
  };
}

/** Franki's floor shadow on the stage, which the slab sits under. */
export const FLOOR_SELECTOR = '[data-stage] [data-part="floor"]';

/**
 * An element's layout box in viewport px, without the transforms on it or its ancestors: the idle float
 * and the stage's glide move Franki by transform, and the slab follows where the layout puts Franki,
 * not each frame of the float.
 */
export function layoutBox(el: HTMLElement, win: Window): Box {
  let x = 0;
  let y = 0;
  let fixed = false;
  for (let n: HTMLElement | null = el; n !== null; n = n.offsetParent instanceof HTMLElement ? n.offsetParent : null) {
    x += n.offsetLeft;
    y += n.offsetTop;
    if (win.getComputedStyle(n).position === "fixed") {
      fixed = true;
      break;
    }
  }
  if (!fixed) {
    x -= win.scrollX;
    y -= win.scrollY;
  }
  return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
}

/**
 * Call `changed` at most once a frame when the page's layout may have moved: on resize, on scroll, when
 * the page's size changes, when elements mount or unmount, and when the lab grid switches between centre
 * and dock (`data-layout`). That last one is reported as "glide", since the stage glides there; the rest
 * as "jump". Returns the cleanup.
 */
export function watchLayout(win: Window, doc: Document, changed: (how: "jump" | "glide") => void): () => void {
  let frame = 0;
  let glide = false;
  const queue = (how: "jump" | "glide") => {
    if (how === "glide") glide = true;
    if (frame !== 0) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      const g = glide;
      glide = false;
      changed(g ? "glide" : "jump");
    });
  };
  const onJump = () => queue("jump");
  win.addEventListener("resize", onJump, { passive: true });
  win.addEventListener("scroll", onJump, { passive: true, capture: true });
  const sizes = new ResizeObserver(onJump);
  sizes.observe(doc.documentElement);
  sizes.observe(doc.body);
  const tree = new MutationObserver((records) => queue(records.some((r) => r.type === "attributes") ? "glide" : "jump"));
  tree.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-layout"] });
  queue("jump");
  return () => {
    if (frame !== 0) win.cancelAnimationFrame(frame);
    win.removeEventListener("resize", onJump, { capture: false });
    win.removeEventListener("scroll", onJump, { capture: true });
    sizes.disconnect();
    tree.disconnect();
  };
}
