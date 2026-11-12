"use client";
// The brass knife switch at the foot of the front door. A glass base plate with four rivets carries two
// brass clips: the jaw at the top, where the blade makes contact, and the hinge at the bottom, where it
// pivots on a pin. The blade rests open at 38 degrees with its dark handle up and to the right.
// It is one <button>. A click, Enter or Space throws it; dragging the handle moves the blade with the
// pointer, and letting go past halfway throws it, otherwise it settles back. The blade never overshoots
// (ui/landing/switch-blade.ts). When it meets the jaw: one spark across the contacts, for about 640 ms of
// frame time, on a grant from the electricity budget; onThrown, once; then the router opens `href`. Under
// reduced motion the blade closes and the page goes at once. The sequence is the pure machine in
// ui/landing/switch-machine.ts; this component runs its commands. The blade's angle is written straight to
// the drawing each frame, so React renders only when the phase, the grant or the spark's bolt changes.
// Below the switch: the signature line, a plain link to `href` that works with scripting off, and the note.
import { useRouter } from "next/navigation";
import { type PointerEvent as ReactPointerEvent, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { bolt } from "../../ui/electricity";
import { electricityBudget } from "../../ui/electricity-budget";
import { LANDING } from "../../ui/copy-landing";
import type { SwitchProps } from "../../ui/landing/steps";
import { OPEN_DEG, type Point, toViewBox } from "../../ui/landing/switch-blade";
import { PIVOT, SPARK_MS, type SwitchEvent, type SwitchPhase, type SwitchState, switchInit, switchStep } from "../../ui/landing/switch-machine";
import { ElectricityView, boltSeed, stillBolt } from "../avatar/Electricity";
import { Plate } from "../lab/Plate";
import { Rivet } from "../lab/Rivet";
import { FOCUS, TARGET } from "../surfaces/classes";

export { PIVOT, SPARK_MS };

/** The drawing's viewBox: a 240 unit square. */
export const VIEW = { x: 0, y: 0, width: 240, height: 240 } as const;
/**
 * The drawing's box: 220 px on phones, growing with the viewport to 320 px from lg (1024 px, where 31.25vw
 * is 320 px). Everything inside is placed in percentages or viewBox units, and a drag reads the box it
 * measures when the press starts, so nothing depends on the size.
 */
export const SWITCH_BOX = "size-[clamp(220px,31.25vw,320px)]";

/** The blade, drawn standing closed (straight up from the pivot); the whole group rotates about the pin. */
const BLADE = { half: 6, top: 78, tail: 214 } as const;
const FERRULE = { half: 8, top: 72, bottom: 79 } as const;
const HANDLE = { half: 8, top: 26, bottom: 75 } as const;
/** How far down the handle its brass end cap reaches, from the handle's top. */
const CAP_COLLAR = 11;
/** The jaw and hinge prongs flank the blade's slot, one unit clear either side. */
const PRONG = { inner: 7, outer: 14 } as const;
const JAW = { top: 80, bottom: 108, baseTop: 104, baseBottom: 116, baseHalf: 20 };
const HINGE = { top: 194, bottom: 216, baseTop: 210, baseBottom: 224, baseHalf: 22 };
/** The spark: an arc across the jaw's contacts, and the flash behind it. */
const SPARK_WAYPOINTS: readonly Point[] = [
  { x: 64, y: 88 },
  { x: 84, y: 79 },
  { x: 104, y: 88 },
];
const SPARK_SEED = 71;
const SPARK_DEPTH = 3;
/** The glass base plate, as a share of the drawing box. */
const PLATE_BOX = { left: "20%", top: "25%", width: "30%", height: "71.667%" } as const;

/** The blade group's transform at an angle, about the hinge pin. */
const bladeTransform = (angle: number) => `rotate(${angle.toFixed(3)} ${PIVOT.x} ${PIVOT.y})`;

/** What React renders from the machine: the rest is written to the drawing directly. */
interface View {
  phase: SwitchPhase;
  granted: boolean;
  near: boolean;
}
const viewOf = (s: SwitchState): View => ({ phase: s.phase, granted: s.token !== null, near: s.near });

/** Opens `href` once, with the router, as soon as it mounts. Mounted only after the throw. */
function Go({ href }: { href: string }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    router.push(href);
  }, [router, href]);
  return null;
}

/** Asks the router to fetch `href` ahead, once. Mounted when a visitor first comes near the switch. */
function Prefetch({ href }: { href: string }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    router.prefetch(href);
  }, [router, href]);
  return null;
}

function Screw({ x, y, fill }: { x: number; y: number; fill: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={3} fill={fill} />
      <path d={`M${x - 1.8} ${y + 1.2}L${x + 1.8} ${y - 1.2}`} stroke="var(--color-night-0)" strokeOpacity={0.55} strokeWidth={0.8} strokeLinecap="round" />
    </g>
  );
}

/** A clip: two prongs either side of the slot, standing on a base block held by two screws. */
interface ClipShape {
  top: number;
  bottom: number;
  baseTop: number;
  baseBottom: number;
  baseHalf: number;
}

function Clip({ top, bottom, baseTop, baseBottom, baseHalf, ids }: ClipShape & { ids: Ids }) {
  const x = PIVOT.x;
  return (
    <g>
      <rect x={x - baseHalf} y={baseTop} width={baseHalf * 2} height={baseBottom - baseTop} rx={2} fill={`url(#${ids.base})`} />
      <path d={`M${x - baseHalf + 1} ${baseTop + 0.5}H${x + baseHalf - 1}`} stroke="var(--color-spark)" strokeOpacity={0.5} strokeWidth={0.8} />
      <Screw x={x - baseHalf + 5} y={(baseTop + baseBottom) / 2} fill={`url(#${ids.pin})`} />
      <Screw x={x + baseHalf - 5} y={(baseTop + baseBottom) / 2} fill={`url(#${ids.pin})`} />
      {[-1, 1].map((side) => {
        const x0 = side < 0 ? x - PRONG.outer : x + PRONG.inner;
        return (
          <g key={side}>
            <rect x={x0} y={top} width={PRONG.outer - PRONG.inner} height={bottom - top} rx={2} fill={`url(#${ids.prong})`} />
            {/* The contact face: a bright edge on the side that meets the blade. */}
            <path d={`M${side < 0 ? x - PRONG.inner - 0.6 : x + PRONG.inner + 0.6} ${top + 2}V${bottom - 2}`} stroke="var(--color-brass-hi)" strokeOpacity={0.9} strokeWidth={0.9} />
          </g>
        );
      })}
    </g>
  );
}

interface Ids {
  blade: string;
  prong: string;
  base: string;
  handle: string;
  pin: string;
  flash: string;
}

/** The blade, its ferrule and handle, drawn closed; `shadow` draws only its silhouette, for the drop shadow. */
function Blade({ ids, shadow = false }: { ids: Ids; shadow?: boolean }) {
  const x = PIVOT.x;
  if (shadow) {
    return (
      <g fill="var(--color-night-0)">
        <rect x={x - BLADE.half} y={BLADE.top} width={BLADE.half * 2} height={BLADE.tail - BLADE.top} rx={2} />
        <rect x={x - HANDLE.half} y={HANDLE.top} width={HANDLE.half * 2} height={HANDLE.bottom - HANDLE.top} rx={HANDLE.half} />
      </g>
    );
  }
  return (
    <g>
      <rect x={x - BLADE.half} y={BLADE.top} width={BLADE.half * 2} height={BLADE.tail - BLADE.top} rx={2} fill={`url(#${ids.blade})`} />
      {/* Light running down the lit edge, and a darker bevel on the far one. */}
      <path d={`M${x - BLADE.half + 1.2} ${BLADE.top + 3}V${BLADE.tail - 12}`} stroke="var(--color-spark)" strokeOpacity={0.6} strokeWidth={0.9} strokeLinecap="round" />
      <path d={`M${x + BLADE.half - 0.8} ${BLADE.top + 3}V${BLADE.tail - 4}`} stroke="var(--color-night-0)" strokeOpacity={0.35} strokeWidth={0.8} />
      {/* The handle, with a light rim so its outline reads on the page's darkest night. */}
      <rect
        data-handle-body=""
        x={x - HANDLE.half}
        y={HANDLE.top}
        width={HANDLE.half * 2}
        height={HANDLE.bottom - HANDLE.top}
        rx={HANDLE.half}
        fill={`url(#${ids.handle})`}
        stroke="color-mix(in srgb, var(--color-ink) 40%, transparent)"
        strokeWidth={1}
      />
      <path d={`M${x - HANDLE.half + 3} ${HANDLE.top + 9}V${HANDLE.bottom - 9}`} stroke="var(--color-ink)" strokeOpacity={0.16} strokeWidth={1.6} strokeLinecap="round" />
      {/* A brass cap on the lever's end: its rounded top and a short collar. */}
      <path
        data-handle-cap=""
        d={`M${x - HANDLE.half} ${HANDLE.top + HANDLE.half}A${HANDLE.half} ${HANDLE.half} 0 0 1 ${x + HANDLE.half} ${HANDLE.top + HANDLE.half}V${HANDLE.top + CAP_COLLAR}H${x - HANDLE.half}Z`}
        fill={`url(#${ids.base})`}
      />
      <path d={`M${x - HANDLE.half + 1} ${HANDLE.top + CAP_COLLAR - 0.5}H${x + HANDLE.half - 1}`} stroke="var(--color-night-0)" strokeOpacity={0.45} strokeWidth={0.8} />
      <rect x={x - FERRULE.half} y={FERRULE.top} width={FERRULE.half * 2} height={FERRULE.bottom - FERRULE.top} rx={1.5} fill={`url(#${ids.base})`} />
      <path d={`M${x - FERRULE.half + 1} ${FERRULE.top + 0.6}H${x + FERRULE.half - 1}`} stroke="var(--color-spark)" strokeOpacity={0.55} strokeWidth={0.8} />
      {/* A wider grab area around the handle, for dragging. */}
      <rect data-handle="" x={x - 14} y={HANDLE.top - 8} width={28} height={HANDLE.bottom - HANDLE.top + 14} rx={14} fill="transparent" className="lower-handle" />
      {/* The hinge pin, turning with the blade: a brass dome with its slot. */}
      <circle cx={x} cy={PIVOT.y} r={5.5} fill={`url(#${ids.pin})`} />
      <path d={`M${x} ${PIVOT.y - 3.2}V${PIVOT.y + 3.2}`} stroke="var(--color-night-0)" strokeOpacity={0.5} strokeWidth={1} strokeLinecap="round" />
    </g>
  );
}

export function Switch({ href, onThrown, reduced }: SwitchProps) {
  const { wake } = LANDING.sections;
  const uid = useId();
  const ids: Ids = {
    blade: `${uid}-blade`,
    prong: `${uid}-prong`,
    base: `${uid}-base`,
    handle: `${uid}-handle`,
    pin: `${uid}-pin`,
    flash: `${uid}-flash`,
  };
  const m = useRef<SwitchState | null>(null);
  const [view, setView] = useState<View>({ phase: "open", granted: false, near: false });
  /** The frame time the spark's current bolt was drawn at. It changes only when the bolt does. */
  const [sparkAt, setSparkAt] = useState<number | null>(null);
  const shown = useRef<View>(view);
  const button = useRef<HTMLButtonElement | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const blade = useRef<SVGGElement | null>(null);
  const shadow = useRef<SVGGElement | null>(null);
  /** The drawing's box, read once when a press starts. */
  const box = useRef<DOMRect | null>(null);
  const raf = useRef<number | null>(null);
  const boltShown = useRef<number | null>(null);
  const thrown = useRef(onThrown);
  useEffect(() => {
    thrown.current = onThrown;
  }, [onThrown]);

  function machine(): SwitchState {
    if (m.current === null) m.current = switchInit(reduced);
    return m.current;
  }

  /** Writes the blade's angle to the drawing and the button, outside React. */
  function paint(s: SwitchState) {
    const t = bladeTransform(s.angle);
    blade.current?.setAttribute("transform", t);
    shadow.current?.setAttribute("transform", t);
    if (button.current !== null) button.current.dataset.angle = String(Math.round(s.angle));
  }

  function dispatch(event: SwitchEvent) {
    const { state, commands } = switchStep(machine(), event);
    m.current = state;
    for (const c of commands) {
      switch (c.kind) {
        case "thrown":
          thrown.current();
          break;
        case "go":
          // The "go" phase mounts <Go>, which asks the router.
          break;
        case "request":
          dispatch({ type: "granted", token: electricityBudget.request() });
          break;
        case "release":
          electricityBudget.release(c.token);
          break;
        case "frame":
          if (raf.current === null) raf.current = requestAnimationFrame(onFrame);
          break;
        case "stopFrames":
          if (raf.current !== null) cancelAnimationFrame(raf.current);
          raf.current = null;
          break;
        case "capture":
          button.current?.setPointerCapture?.(c.id);
          break;
        case "clickWindow":
          // The click that follows a release fires in the same task, if at all.
          setTimeout(() => dispatch({ type: "clickSettled" }));
          break;
        default:
          c satisfies never;
      }
    }
    const s = machine();
    paint(s);
    const next = viewOf(s);
    const prev = shown.current;
    if (prev.phase !== next.phase || prev.granted !== next.granted || prev.near !== next.near) {
      shown.current = next;
      setView(next);
    }
  }

  function onFrame(t: number) {
    raf.current = null;
    dispatch({ type: "frame", t });
    if (machine().phase === "spark") {
      const seed = boltSeed(t, SPARK_SEED);
      if (boltShown.current !== seed) {
        boltShown.current = seed;
        setSparkAt(t);
      }
    } else if (boltShown.current !== null) {
      boltShown.current = null;
      setSparkAt(null);
    }
  }

  const onReduced = useEffectEvent((on: boolean) => dispatch({ type: "reduced", on }));
  useEffect(() => {
    onReduced(reduced);
  }, [reduced]);

  const onUnmount = useEffectEvent(() => dispatch({ type: "unmount" }));
  useEffect(() => () => onUnmount(), []);

  /** The pointer, in the drawing's viewBox, against the box read when the press began. */
  const toView = (e: ReactPointerEvent): Point => {
    const r = box.current;
    if (r === null) return PIVOT;
    return toViewBox(r, VIEW, { x: e.clientX, y: e.clientY });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    box.current = svg.current?.getBoundingClientRect() ?? null;
    const onHandle = e.target instanceof Element && e.target.closest("[data-handle]") !== null;
    dispatch({ type: "grab", id: e.pointerId, button: e.button, onHandle, at: toView(e), client: { x: e.clientX, y: e.clientY } });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (machine().drag === null) return;
    dispatch({
      type: "move",
      id: e.pointerId,
      at: toView(e),
      client: { x: e.clientX, y: e.clientY },
      buttonsUp: e.pointerType === "mouse" && e.buttons === 0,
    });
  };

  const sparking = view.phase === "spark" && !reduced;
  const sparkSeed = boltSeed(sparkAt ?? 0, SPARK_SEED);
  return (
    <section id="wake" aria-labelledby="wake-title" className="flex flex-col items-center gap-6 pt-16 pb-8 text-center">
      <h2 id="wake-title" className="font-display text-title text-ink">
        {wake.title}
      </h2>
      <button
        ref={button}
        type="button"
        aria-label={wake.lever}
        data-switch=""
        data-phase={view.phase}
        data-angle={OPEN_DEG}
        className={`${FOCUS} lower-switch relative flex flex-col items-center gap-4 rounded-card p-3`}
        onClick={() => dispatch({ type: "click" })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => dispatch({ type: "release", id: e.pointerId })}
        onPointerCancel={(e) => dispatch({ type: "cancel", id: e.pointerId })}
        onLostPointerCapture={(e) => dispatch({ type: "cancel", id: e.pointerId })}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") dispatch({ type: "near", key: "hovered", on: true });
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") dispatch({ type: "near", key: "hovered", on: false });
        }}
        onFocus={() => dispatch({ type: "near", key: "focused", on: true })}
        onBlur={() => dispatch({ type: "near", key: "focused", on: false })}
      >
        <span aria-hidden="true" className={`relative block ${SWITCH_BOX}`}>
          <span data-base-plate="" className="mat-glass absolute block rounded-control" style={PLATE_BOX}>
            <Rivet className="absolute top-1.5 left-1.5" />
            <Rivet className="absolute top-1.5 right-1.5" />
            <Rivet className="absolute bottom-1.5 left-1.5" />
            <Rivet className="absolute right-1.5 bottom-1.5" />
          </span>
          <svg ref={svg} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`} focusable="false" className="absolute inset-0 size-full overflow-visible">
            <defs>
              {/* Brass lit from the upper left: bright on the near edge, falling to a dark far edge. */}
              <linearGradient id={ids.blade} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="var(--color-brass-hi)" />
                <stop offset="0.4" stopColor="var(--color-brass)" />
                <stop offset="1" stopColor="color-mix(in srgb, var(--color-brass) 58%, var(--color-night-0))" />
              </linearGradient>
              <linearGradient id={ids.prong} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="var(--color-brass-hi)" />
                <stop offset="0.55" stopColor="var(--color-brass)" />
                <stop offset="1" stopColor="color-mix(in srgb, var(--color-brass) 62%, var(--color-night-0))" />
              </linearGradient>
              <linearGradient id={ids.base} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--color-brass-hi)" />
                <stop offset="0.45" stopColor="var(--color-brass)" />
                <stop offset="1" stopColor="color-mix(in srgb, var(--color-brass) 55%, var(--color-night-0))" />
              </linearGradient>
              {/* The handle: dark lacquer, lit on its near side so it stands off the night behind it. */}
              <linearGradient id={ids.handle} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="color-mix(in srgb, var(--color-ink-dim) 34%, var(--color-night-2))" />
                <stop offset="0.45" stopColor="var(--color-night-2)" />
                <stop offset="1" stopColor="var(--color-night-1)" />
              </linearGradient>
              <radialGradient id={ids.pin} cx="0.35" cy="0.3" r="0.75">
                <stop offset="0" stopColor="var(--color-spark)" />
                <stop offset="0.25" stopColor="var(--color-brass-hi)" />
                <stop offset="0.6" stopColor="var(--color-brass)" />
                <stop offset="1" stopColor="color-mix(in srgb, var(--color-brass) 55%, var(--color-night-0))" />
              </radialGradient>
              <radialGradient id={ids.flash}>
                <stop offset="0" stopColor="var(--color-spark)" stopOpacity={0.9} />
                <stop offset="0.4" stopColor="var(--color-gold)" stopOpacity={0.35} />
                <stop offset="1" stopColor="var(--color-gold)" stopOpacity={0} />
              </radialGradient>
            </defs>
            <Clip {...HINGE} ids={ids} />
            <Clip {...JAW} ids={ids} />
            <g transform="translate(3 4)" opacity={0.4}>
              <g ref={shadow} transform={bladeTransform(OPEN_DEG)}>
                <Blade ids={ids} shadow />
              </g>
            </g>
            <g ref={blade} data-blade="" transform={bladeTransform(OPEN_DEG)}>
              <Blade ids={ids} />
            </g>
            {sparking ? (
              // The flash and the live bolt only on a grant; without one, the budget's still crackle.
              <g data-spark="" data-granted={view.granted ? "" : undefined}>
                {view.granted ? (
                  <>
                    <circle className="lower-flash" cx={PIVOT.x} cy={SPARK_WAYPOINTS[0].y - 2} r={26} fill={`url(#${ids.flash})`} />
                    <ElectricityView waypoints={SPARK_WAYPOINTS} shape={bolt(SPARK_WAYPOINTS, sparkSeed, SPARK_DEPTH)} granted flashKey={sparkSeed} />
                  </>
                ) : (
                  <ElectricityView waypoints={SPARK_WAYPOINTS} shape={stillBolt(SPARK_WAYPOINTS, SPARK_SEED, SPARK_DEPTH)} granted={false} />
                )}
              </g>
            ) : null}
          </svg>
        </span>
        <Plate>{wake.lever}</Plate>
      </button>
      {view.phase === "go" ? <Go href={href} /> : null}
      {view.near && view.phase !== "go" ? <Prefetch href={href} /> : null}
      <p className="font-display text-2xl text-ink">{wake.signature}</p>
      <a
        href={href}
        className={`${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control px-3 text-base text-ink underline decoration-ink-dim underline-offset-4 transition-colors duration-(--dur-quick) hover:decoration-brass`}
      >
        {wake.walkIn}
      </a>
      <p className="text-sm text-ink-dim">{wake.note}</p>
    </section>
  );
}
