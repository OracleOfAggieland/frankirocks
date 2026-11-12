"use client";
// The lab spider that replaces the pointer on a fine pointer with motion allowed and the toggle on.
// Nothing is rendered on the server. One frame loop steps the pure spider (ui/cursor/spider.ts) and writes
// transforms and opacity straight to the drawing, with no React render per move. Pointer listeners are
// passive: the spider never captures the pointer, never cancels an event, and reads no layout per frame.
import { useEffect, useId, useRef } from "react";
import { BODY, DEG, LEGS, LOWER, UPPER, polar } from "../../ui/cursor/geometry";
import { type SpiderInput, type SpiderPose, RING_R, THREAD, initialSpider, spiderPose, stepSpider } from "../../ui/cursor/spider";
import { type Over, classify } from "../../ui/cursor/targets";
import { MAX_WEBS, webShape } from "../../ui/cursor/web";
import { browserVisibility } from "../../ui/hooks/page-visible";
import { useSpiderCanRun, useSpiderOn } from "./use-spider";

export function SpiderCursor() {
  const canRun = useSpiderCanRun();
  const on = useSpiderOn();
  if (!canRun || !on) return null;
  return <SpiderLayer />;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const f = (n: number) => n.toFixed(2);

/** An arc of the touch ring, from one angle to another (degrees, clockwise on screen). */
function ringArc(fromDeg: number, toDeg: number): string {
  const a = polar(RING_R, fromDeg * DEG);
  const b = polar(RING_R, toDeg * DEG);
  return `M${f(a.x)} ${f(a.y)}A${RING_R} ${RING_R} 0 0 1 ${f(b.x)} ${f(b.y)}`;
}
const RING_LIGHT = ringArc(-168, -102);
const RING_SHADE = ringArc(18, 78);

/** The seam across the abdomen, with three cross-ticks: Franki's stitch. */
const STITCH = (() => {
  const from = -BODY.abdomenBack + BODY.abdomenRx * 0.5;
  const to = -BODY.abdomenBack - BODY.abdomenRx * 0.55;
  const ticks = [0.32, 0, -0.32].map((k) => -BODY.abdomenBack + k * BODY.abdomenRx);
  const half = BODY.abdomenRy * 0.3;
  return `M${f(from)} 0L${f(to)} 0` + ticks.map((x) => `M${f(x)} ${f(-half)}L${f(x)} ${f(half)}`).join("");
})();

function SpiderLayer() {
  const layer = useRef<HTMLDivElement>(null);
  const webs = useRef<HTMLDivElement>(null);
  const id = `spider${useId().replace(/[^\w-]/g, "")}`;

  useEffect(() => {
    const el = layer.current;
    const webLayer = webs.current;
    if (el === null || webLayer === null) return;
    return runSpider(el, webLayer);
  }, []);

  return (
    <>
      <div ref={webs} className="spider-webs" aria-hidden="true" />
      <div ref={layer} className="spider-layer" aria-hidden="true">
        <svg width="96" height="96" viewBox="-48 -48 96 96" focusable="false">
          <defs>
            <radialGradient id={`${id}-abdomen`} cx="0.64" cy="0.42" r="0.72">
              <stop offset="0" className="spider-lit" />
              <stop offset="0.5" className="spider-lit" />
              <stop offset="1" className="spider-shade" />
            </radialGradient>
            <radialGradient id={`${id}-head`} cx="0.42" cy="0.4" r="0.78">
              <stop offset="0" className="spider-lit" />
              <stop offset="0.62" className="spider-lit" />
              <stop offset="1" className="spider-shade" />
            </radialGradient>
            <linearGradient id={`${id}-thread`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={-THREAD}>
              <stop offset="0" className="spider-thread-near" />
              <stop offset="1" className="spider-thread-far" />
            </linearGradient>
          </defs>
          <g data-part="ring" opacity="0">
            <circle className="spider-ring" r={RING_R} />
            <path className="spider-ring-shade" d={RING_SHADE} />
            <path className="spider-ring-light" d={RING_LIGHT} />
          </g>
          <g data-part="sway">
            <line data-part="thread" className="spider-thread" x1="0" y1="-1" x2="0" y2={-THREAD} stroke={`url(#${id}-thread)`} opacity="0" />
            <g>
              {Array.from({ length: LEGS }, (_, leg) => (
                <g key={leg}>
                  <line data-bone="" className="spider-leg" x1="0" y1="0" x2={UPPER} y2="0" />
                  <line data-bone="" className="spider-leg" x1="0" y1="0" x2={LOWER} y2="0" />
                </g>
              ))}
            </g>
            <g data-part="body">
              <ellipse className="spider-body" cx={-BODY.abdomenBack} cy="0" rx={BODY.abdomenRx} ry={BODY.abdomenRy} fill={`url(#${id}-abdomen)`} />
              <path className="spider-stitch" d={STITCH} />
              <circle className="spider-body" r={BODY.headR} fill={`url(#${id}-head)`} />
              <circle className="spider-eye" cx={BODY.eyeForward} cy={-BODY.eyeApart} r={BODY.eyeR} />
              <circle className="spider-eye" cx={BODY.eyeForward} cy={BODY.eyeApart} r={BODY.eyeR} />
            </g>
          </g>
        </svg>
      </div>
    </>
  );
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Pointerish = { pointerType: string };
const mouseOrPen = (e: Pointerish) => e.pointerType === "mouse" || e.pointerType === "pen";

/** Starts the spider on its drawing and returns the function that stops it and puts the native cursor back. */
function runSpider(layer: HTMLDivElement, webLayer: HTMLDivElement): () => void {
  const ring = layer.querySelector<SVGGElement>('[data-part="ring"]');
  const sway = layer.querySelector<SVGGElement>('[data-part="sway"]');
  const thread = layer.querySelector<SVGLineElement>('[data-part="thread"]');
  const body = layer.querySelector<SVGGElement>('[data-part="body"]');
  const bones = Array.from(layer.querySelectorAll<SVGLineElement>("[data-bone]"));
  if (ring === null || sway === null || thread === null || body === null || bones.length !== LEGS * 2) return () => {};

  const html = document.documentElement;
  const visibility = browserVisibility();
  let state = initialSpider;
  const input: Mutable<Omit<SpiderInput, "t">> = {
    x: 0,
    y: 0,
    present: false,
    touch: false,
    text: false,
    pressed: false,
  };
  let seen = false;
  let visible = visibility.isVisible();
  let running = false;
  let handle: number | null = null;
  let lastTarget: EventTarget | null = null;
  let over: Over = "none";
  let webSeed = 0x5eed;
  const liveWebs: HTMLElement[] = [];

  // Each written value is kept, so a frame writes only what changed.
  const written = new Map<string, string>();
  const attr = (key: string, node: Element, name: string, value: string) => {
    if (written.get(key) === value) return;
    written.set(key, value);
    node.setAttribute(name, value);
  };
  const style = (key: string, name: "transform" | "opacity", value: string) => {
    if (written.get(key) === value) return;
    written.set(key, value);
    layer.style[name] = value;
  };

  const draw = (p: SpiderPose) => {
    style("t", "transform", `translate3d(${f(p.x)}px, ${f(p.y)}px, 0)`);
    style("o", "opacity", f(p.opacity));
    attr("rt", ring, "transform", `scale(${f(p.ringScale)})`);
    attr("ro", ring, "opacity", f(p.ringOpacity));
    attr("s", sway, "transform", `rotate(${f(p.sway)} 0 ${-THREAD})`);
    attr("th", thread, "opacity", f(p.threadOpacity));
    attr("b", body, "transform", `rotate(${f(p.heading)}) scale(${f(p.bodyScale)})`);
    p.legs.forEach((leg, i) => {
      attr(`u${i}`, bones[i * 2], "transform", `translate(${f(leg.hip.x)} ${f(leg.hip.y)}) rotate(${f(leg.upper)})`);
      attr(`l${i}`, bones[i * 2 + 1], "transform", `translate(${f(leg.knee.x)} ${f(leg.knee.y)}) rotate(${f(leg.lower)})`);
    });
  };

  const frame = (t: number) => {
    handle = null;
    if (!running) return;
    state = stepSpider(state, { t, ...input });
    draw(spiderPose(state));
    // Gone from the window and faded out: sleep until the pointer comes back.
    if (!input.present && state.presence.x < 0.002 && Math.abs(state.presence.v) < 0.01) {
      running = false;
      return;
    }
    handle = requestAnimationFrame(frame);
  };
  const wake = () => {
    if (running || !visible || !seen) return;
    running = true;
    handle = requestAnimationFrame(frame);
  };
  const sleep = () => {
    running = false;
    if (handle !== null) cancelAnimationFrame(handle);
    handle = null;
  };

  const look = (target: EventTarget | null) => {
    if (target !== lastTarget) {
      lastTarget = target;
      over = classify(target instanceof Element ? target : null);
    }
    input.touch = over === "touch";
    input.text = over === "text";
    input.present = over !== "away";
  };

  const onMove = (e: PointerEvent) => {
    if (!mouseOrPen(e)) {
      input.present = false;
      wake();
      return;
    }
    // A release the page never heard (a native popup, a scrollbar drag) ends the press here.
    if (input.pressed && (e.buttons & 1) === 0) input.pressed = false;
    input.x = e.clientX;
    input.y = e.clientY;
    look(e.target);
    if (!seen) {
      seen = true;
      html.dataset.spider = "on";
    }
    wake();
  };
  const onDown = (e: PointerEvent) => {
    if (!mouseOrPen(e) || e.button !== 0) return;
    input.pressed = true;
    lastTarget = null;
    wake();
  };
  const onUp = (e: PointerEvent) => {
    if (!input.pressed) return;
    input.pressed = false;
    lastTarget = null;
    look(e.target);
    if (mouseOrPen(e) && e.button === 0 && over !== "text" && over !== "away") spawnWeb(e.clientX, e.clientY);
    wake();
  };
  const onCancel = () => {
    input.pressed = false;
    wake();
  };
  const onOut = (e: PointerEvent) => {
    if (e.relatedTarget !== null) return;
    input.present = false;
    input.pressed = false;
    wake();
  };
  // The element under a still pointer can change (a scroll, a control removed by a click): look again.
  const onOver = (e: PointerEvent) => {
    if (!mouseOrPen(e) || !seen) return;
    input.x = e.clientX;
    input.y = e.clientY;
    look(e.target);
    wake();
  };
  const onBlur = () => {
    input.pressed = false;
    wake();
  };
  const unsubscribe = visibility.subscribe((v) => {
    visible = v;
    if (v) wake();
    else sleep();
  });

  const spawnWeb = (x: number, y: number) => {
    const shape = webShape(webSeed++);
    const at = document.createElement("div");
    at.style.position = "absolute";
    at.style.left = "0";
    at.style.top = "0";
    at.style.transform = `translate3d(${f(x)}px, ${f(y)}px, 0)`;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "spider-web");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "-12 -12 24 24");
    svg.setAttribute("focusable", "false");
    for (const d of [shape.spokes, shape.rings]) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    svg.addEventListener("animationend", (ev) => {
      if (ev.animationName !== "spider-web-fade") return;
      at.remove();
      const i = liveWebs.indexOf(at);
      if (i >= 0) liveWebs.splice(i, 1);
    });
    at.appendChild(svg);
    webLayer.appendChild(at);
    liveWebs.push(at);
    while (liveWebs.length > MAX_WEBS) liveWebs.shift()?.remove();
  };

  const opts: AddEventListenerOptions = { passive: true, capture: true };
  window.addEventListener("pointermove", onMove, opts);
  window.addEventListener("pointerdown", onDown, opts);
  window.addEventListener("pointerup", onUp, opts);
  window.addEventListener("pointercancel", onCancel, opts);
  window.addEventListener("pointerout", onOut, opts);
  window.addEventListener("pointerover", onOver, opts);
  window.addEventListener("blur", onBlur);

  return () => {
    sleep();
    unsubscribe();
    window.removeEventListener("pointermove", onMove, opts);
    window.removeEventListener("pointerdown", onDown, opts);
    window.removeEventListener("pointerup", onUp, opts);
    window.removeEventListener("pointercancel", onCancel, opts);
    window.removeEventListener("pointerout", onOut, opts);
    window.removeEventListener("pointerover", onOver, opts);
    window.removeEventListener("blur", onBlur);
    for (const w of liveWebs.splice(0)) w.remove();
    if (html.dataset.spider === "on") delete html.dataset.spider;
  };
}
