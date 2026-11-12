"use client";
// The lab scenery (UI direction "The lab scenery"): blueprint linework of Franki's lab at night, one
// 1440 by 900 drawing that covers the viewport from the bottom up. Stitch strokes only, no fill, no
// glow, and nothing moves by itself.
// - The cables, the web and the mains label hang from the top of the screen: they are shifted down by
//   however much the slice crops off the top (and the web in by the side crop), so a wide window never
//   cuts them away.
// - The slab sits under Franki's floor shadow: it is placed from the shadow's layout box on resize,
//   scroll and layout change, and springs to its new place when the stage glides to the dock.
// - The labels are written at 12 screen px whatever the drawing's scale.
// - The drawing shifts against the pointer in two depths (far 3 px, near 6 px) through motion values on
//   spring.float, so a pointer move never renders React. There is no shift and no pointer listener under
//   Reduced_Motion, and no listener while the tab is hidden.
// Below 1024 px, and on screens much taller than wide, the shelf, the bench and their labels drop; below
// 640 px only the floor and the slab stay.
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { type ReactNode, type Ref, useEffect, useLayoutEffect, useRef } from "react";
import { usePageVisible } from "../../ui/hooks/page-visible";
import { useReducedMotion } from "../../ui/hooks/reduced-motion";
import { SPRING } from "../../ui/motion";
import { FIG } from "../lab/FigLabel";
import {
  DEPTH,
  SCENE,
  type Point,
  catenaryPoints,
  catenaryY,
  coverScale,
  placeOnBox,
  placePoint,
  placementTransform,
  polyline,
  sliceCrop,
  solveCatenary,
  webPaths,
} from "./geometry";
import { CABLES, DISCS, DISC_RY, SLAB, SLAB_MAX_SHARE, SLAB_PER_FLOOR, WEB_SPEC } from "./scene";
import { FLOOR_SELECTOR, layoutBox, watchLayout, watchPointer } from "./watch";

export type SceneryVariant = "lab" | "door";

/** The fig label words. Decorative: the whole drawing is aria-hidden. */
const FIG_WORDS = { mains: "the mains", specimens: "specimens", slab: "the slab", bench: "the bench" } as const;
/**
 * The mains label's number: 1 in the lab; 0 at the door, whose pages number their own figures from 1
 * (the front door's hero, the 404 and 500 rooms).
 */
const MAINS_N = { lab: "1", door: "0" } as const;

/** Group opacities. Near things up to 0.55, far things about 0.3. */
const OPACITY = { cables: 0.3, web: 0.34, shelf: 0.32, figs: 0.45, floor: 0.42, bench: 0.5, slab: 0.55 } as const;

/** A centre line, drawn long-short as on a technical drawing. */
const CHAIN = "10 3 2 3";
/** A hidden edge, drawn dashed. */
const HIDDEN = "4 4";

// Each cable is sampled at about one point per 35 units, enough that a 1 px line reads as a smooth curve.
const CABLE_PATHS = CABLES.map((c) => polyline(catenaryPoints(c.from, c.to, c.a, c.segments)));
const INSULATORS = CABLES.flatMap((c) => [c.from, c.to]);
const DROPS = INSULATORS.map((p) => `M${p.x} -10 V${p.y}`).join(" ");

// The mains label hangs off the first cable, near its right insulator.
const MAINS_X = 500;
const MAINS_AT = { x: MAINS_X, y: Math.round(catenaryY(solveCatenary(CABLES[0].from, CABLES[0].to, CABLES[0].a), MAINS_X) * 10) / 10 };

const WEB = webPaths(WEB_SPEC);

// The floor: the wall's base line across the room, with a tick every 240 units.
const HORIZON_Y = 470;
const HORIZON = `M0 ${HORIZON_Y} H${SCENE.width} ${Array.from({ length: 6 }, (_, i) => `M${120 + i * 240} ${HORIZON_Y} V${HORIZON_Y + 6}`).join(" ")}`;
// Floor seams running toward a vanishing point at the room's centre, drawn only in front of the wall.
const VANISH = { x: 720, y: HORIZON_Y };
const SEAM_TOP = 560;
const SEAMS = [320, 760]
  .flatMap((d) => [-d, d])
  .map((d) => {
    const t = (SEAM_TOP - VANISH.y) / (SCENE.height - VANISH.y);
    return `M${Math.round((VANISH.x + d * t) * 10) / 10} ${SEAM_TOP} L${VANISH.x + d} ${SCENE.height}`;
  })
  .join(" ");

const SLAB_CENTRE: Point = { x: SLAB.cx, y: SLAB.cy };
const SLAB_L = SLAB.cx - SLAB.rx;
const SLAB_R = SLAB.cx + SLAB.rx;
const SLAB_LOW = SLAB.cy + SLAB.h;
/** FIG. 3's dot: on the slab's lower front edge, right of centre. */
const SLAB_DOT: Point = { x: SLAB.cx + 80, y: Math.round((SLAB_LOW + SLAB.ry * Math.sqrt(1 - (80 / SLAB.rx) ** 2)) * 10) / 10 };

// The coil's windings, stacked from the plinth up.
const COIL = { cx: 1220, rx: 18, ry: 4 } as const;
const WINDINGS = Array.from({ length: 9 }, (_, i) => 400 - i * 10);

function Cables() {
  return (
    <g data-scenery="cables" opacity={OPACITY.cables} className="max-sm:hidden">
      <path d={DROPS} />
      {INSULATORS.map((p) =>
        DISCS.map((d) => <ellipse key={`${p.x}:${d.dy}`} cx={p.x} cy={p.y + d.dy} rx={d.rx} ry={DISC_RY} />),
      )}
      {CABLE_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  );
}

function Web() {
  return (
    <g data-scenery="web" opacity={OPACITY.web} className="max-sm:hidden">
      <path d={WEB.threads} />
      <path d={WEB.rings} />
    </g>
  );
}

function Shelf() {
  return (
    <g data-scenery="shelf" opacity={OPACITY.shelf} className="max-lg:hidden">
      {/* The board and its two brackets. */}
      <path d="M150 410 H520 V420 H150 Z M196 420 V455 L230 420 M474 420 V455 L440 420" />
      {/* A wide specimen jar: body, shoulders, neck, a lid with a knob, the fluid line and two bubbles. */}
      <path d="M188 324 V332 Q178 332 178 340 V410 H242 V340 Q242 332 232 332 V324 M184 324 H236 V314 H184 Z M205 314 V309 H215 V314 M182 354 H238" />
      <circle cx={204} cy={376} r={2.5} />
      <circle cx={214} cy={366} r={1.5} />
      {/* A tall narrow jar. */}
      <path d="M270 314 V322 Q262 322 262 330 V410 H306 V330 Q306 322 298 322 V314 M266 314 H302 V306 H266 Z M266 350 H302" />
      {/* A squat jar. */}
      <path d="M336 354 V360 Q326 360 326 368 V410 H398 V368 Q398 360 388 360 V354 M332 354 H392 V346 H332 Z M330 380 H394" />
      {/* A round-bottomed flask on a cork ring: the bulb as one arc that leaves the neck open, the neck, its lip, the fluid line. */}
      <path d="M465 340.8 A32 32 0 1 1 451 340.8 M451 340.8 V308 M465 340.8 V308 M448 308 H468 M428.3 384 H487.7" />
      <ellipse cx={458} cy={406} rx={16} ry={4} />
      <path d="M458 298 V416" strokeDasharray={CHAIN} />
    </g>
  );
}

function Bench() {
  return (
    <g data-scenery="bench" opacity={OPACITY.bench} className="max-lg:hidden">
      {/* The top, its cut end hatched, two legs with feet, and a stretcher. */}
      <path d="M1010 420 H1300 V432 H1010 Z M1046 420 V432" />
      <path d="M1010 432 L1022 420 M1018 432 L1030 420 M1026 432 L1038 420 M1034 432 L1046 420" />
      <path d="M1028 432 V540 M1038 432 V540 M1272 432 V540 M1282 432 V540 M1022 540 H1044 M1266 540 H1288 M1038 498 H1272 M1038 506 H1272" />
      {/* The Jacob's ladder: a base block, two insulator posts, two rods that spread apart as they rise. */}
      <path d="M1070 420 V406 H1130 V420 M1090 396 L1068 296 M1110 396 L1132 296" />
      {[1090, 1110].map((x) => [398, 402].map((y) => <ellipse key={`${x}:${y}`} cx={x} cy={y} rx={6} ry={2} />))}
      <circle cx={1068} cy={296} r={2.5} />
      <circle cx={1132} cy={296} r={2.5} />
      {/* The coil: a plinth, a stack of windings, a stem and a toroid on top, its axis, and a height dimension. */}
      <path d="M1192 420 V408 H1248 V420 M1202 408 V318 M1238 408 V318 M1220 314 V306" />
      {WINDINGS.map((y) => (
        <ellipse key={y} cx={COIL.cx} cy={y} rx={COIL.rx} ry={COIL.ry} />
      ))}
      <ellipse cx={COIL.cx} cy={296} rx={36} ry={10} />
      <ellipse cx={COIL.cx} cy={294} rx={13} ry={3.5} />
      <path d={`M${COIL.cx} 276 V430`} strokeDasharray={CHAIN} />
      <path d="M1260 286 H1282 M1276 286 V420 M1271 291 L1281 281 M1271 425 L1281 415" />
    </g>
  );
}

function Floor({ seams }: { seams: boolean }) {
  return (
    <g data-scenery="floor" opacity={OPACITY.floor}>
      <path d={HORIZON} />
      {seams ? <path d={SEAMS} opacity={0.6} /> : null}
    </g>
  );
}

function Slab({ placeRef }: { placeRef: Ref<SVGGElement> }) {
  return (
    <g ref={placeRef} data-scenery="slab" opacity={OPACITY.slab}>
      <ellipse cx={SLAB.cx} cy={SLAB.cy} rx={SLAB.rx} ry={SLAB.ry} />
      <ellipse cx={SLAB.cx} cy={SLAB.cy} rx={SLAB.rx * 0.68} ry={SLAB.ry * 0.68} />
      {/* The rim's sides and its front edge; the back edge is hidden behind the top face, so it is dashed. */}
      <path d={`M${SLAB_L} ${SLAB.cy} V${SLAB_LOW} M${SLAB_R} ${SLAB.cy} V${SLAB_LOW} M${SLAB_L} ${SLAB_LOW} A${SLAB.rx} ${SLAB.ry} 0 0 0 ${SLAB_R} ${SLAB_LOW}`} />
      <path d={`M${SLAB_L} ${SLAB_LOW} A${SLAB.rx} ${SLAB.ry} 0 0 1 ${SLAB_R} ${SLAB_LOW}`} strokeDasharray={HIDDEN} opacity={0.5} />
      {/* A centre mark and centre line. */}
      <path d={`M${SLAB.cx - 12} ${SLAB.cy} H${SLAB.cx + 12} M${SLAB.cx} ${SLAB.cy - 6} V${SLAB.cy + 6}`} />
      <path d={`M${SLAB.cx} ${SLAB.cy - 32} V${SLAB.cy + 66}`} strokeDasharray={CHAIN} opacity={0.7} />
      {/* A width dimension under it: extension lines, the dimension line, slash ticks. Not on phones, where its ends would be off screen. */}
      <path
        d={`M${SLAB_L} ${SLAB_LOW + 8} V${SLAB_LOW + 56} M${SLAB_R} ${SLAB_LOW + 8} V${SLAB_LOW + 56} M${SLAB_L} ${SLAB_LOW + 50} H${SLAB_R} M${SLAB_L - 5} ${SLAB_LOW + 55} L${SLAB_L + 5} ${SLAB_LOW + 45} M${SLAB_R - 5} ${SLAB_LOW + 55} L${SLAB_R + 5} ${SLAB_LOW + 45}`}
        opacity={0.7}
        className="max-sm:hidden"
      />
    </g>
  );
}

/** One fig label: a dot on the thing, a leader, and the words in mono. The text size is set in scenery.css. */
function Fig({ n, words, dot, leader, text, className }: { n: string; words: string; dot: Point; leader: string; text: Point; className?: string }) {
  return (
    <g data-fig={n} className={className}>
      <circle cx={dot.x} cy={dot.y} r={1.6} />
      <path d={leader} />
      <text x={text.x} y={text.y} className="fill-ink-dim stroke-none font-mono">
        {`${FIG} ${n} · ${words}`}
      </text>
    </g>
  );
}

/** A group of fig labels at one depth. */
function Figs({ children }: { children: ReactNode }) {
  return (
    <g data-scenery="figs" opacity={OPACITY.figs} className="max-sm:hidden">
      {children}
    </g>
  );
}

export function Scenery({ variant = "lab" }: { variant?: SceneryVariant }) {
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const lab = variant === "lab";

  const svgRef = useRef<SVGSVGElement>(null);
  const topRef = useRef<SVGGElement>(null);
  const webRef = useRef<SVGGElement>(null);
  const slabRef = useRef<SVGGElement>(null);
  const slabFigRef = useRef<SVGGElement>(null);

  const ux = useMotionValue(0);
  const uy = useMotionValue(0);
  const sx = useSpring(ux, SPRING.float);
  const sy = useSpring(uy, SPRING.float);
  const farX = useTransform(sx, (v) => v * DEPTH.far);
  const farY = useTransform(sy, (v) => v * DEPTH.far);
  const nearX = useTransform(sx, (v) => v * DEPTH.near);
  const nearY = useTransform(sy, (v) => v * DEPTH.near);

  // The slab's place, as three motion values that glide on spring.settle with the stage.
  const pdx = useMotionValue(0);
  const pdy = useMotionValue(0);
  const pk = useMotionValue(1);
  const gdx = useSpring(pdx, SPRING.settle);
  const gdy = useSpring(pdy, SPRING.settle);
  const gk = useSpring(pk, SPRING.settle);

  // Write the slab's place straight to the DOM, never through a render.
  useEffect(() => {
    if (!lab) return;
    const write = () => {
      const p = { dx: gdx.get(), dy: gdy.get(), k: gk.get() };
      slabRef.current?.setAttribute("transform", placementTransform(p, SLAB_CENTRE));
      const dot = placePoint(p, SLAB_CENTRE, SLAB_DOT);
      slabFigRef.current?.setAttribute("transform", `translate(${Math.round((dot.x - SLAB_DOT.x) * 10) / 10} ${Math.round((dot.y - SLAB_DOT.y) * 10) / 10})`);
    };
    const offs = [gdx.on("change", write), gdy.on("change", write), gk.on("change", write)];
    return () => offs.forEach((off) => off());
  }, [lab, gdx, gdy, gk]);

  // The crop, the label size and the slab's place follow the window and the page layout.
  useLayoutEffect(() => {
    if (!visible) return;
    return watchLayout(window, document, (how) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const crop = sliceCrop(w, h);
      topRef.current?.setAttribute("transform", `translate(0 ${Math.round(crop.top * 10) / 10})`);
      webRef.current?.setAttribute("transform", `translate(${-Math.round(crop.side * 10) / 10} ${Math.round(crop.top * 10) / 10})`);
      svgRef.current?.style.setProperty("--scenery-inv", String(Math.round((1000 / coverScale(w, h))) / 1000));
      if (!lab) return;
      const floor = document.querySelector(FLOOR_SELECTOR);
      if (!(floor instanceof HTMLElement)) return;
      const p = placeOnBox(layoutBox(floor, window), w, h, { centre: SLAB_CENTRE, width: SLAB.rx * 2 }, SLAB_PER_FLOOR, SLAB_MAX_SHARE);
      const pairs = [
        [pdx, gdx, p.dx],
        [pdy, gdy, p.dy],
        [pk, gk, p.k],
      ] as const;
      for (const [target, spring, v] of pairs) {
        if (how === "glide" && !reduced) target.set(v);
        else {
          target.jump(v);
          spring.jump(v);
        }
      }
    });
  }, [visible, lab, reduced, pdx, pdy, pk, gdx, gdy, gk]);

  // The pointer parallax.
  useEffect(() => {
    if (reduced) {
      ux.jump(0);
      uy.jump(0);
      sx.jump(0);
      sy.jump(0);
      return;
    }
    if (!visible) return;
    return watchPointer(window, (u) => {
      ux.set(u.x);
      uy.set(u.y);
    });
  }, [reduced, visible, ux, uy, sx, sy]);

  return (
    <svg
      ref={svgRef}
      data-layer="scenery"
      data-scenery-art=""
      data-variant={variant}
      viewBox={`0 0 ${SCENE.width} ${SCENE.height}`}
      preserveAspectRatio="xMidYMax slice"
      className="mat-blueprint absolute inset-0 h-full w-full"
      focusable="false"
    >
      <motion.g data-depth="far" style={{ x: farX, y: farY }}>
        {lab ? (
          <>
            <Shelf />
            <Figs>
              <Fig n="2" words={FIG_WORDS.specimens} dot={{ x: 300, y: 422 }} leader="M300 424 V440" text={{ x: 306, y: 446 }} className="max-lg:hidden" />
            </Figs>
          </>
        ) : null}
        {/* Hung from the top of the screen: shifted down by the top crop. */}
        <g ref={topRef} data-crop="top">
          <Cables />
          <Figs>
            <Fig n={MAINS_N[variant]} words={FIG_WORDS.mains} dot={MAINS_AT} leader={`M${MAINS_AT.x} ${MAINS_AT.y + 2} V${MAINS_AT.y + 18}`} text={{ x: MAINS_X + 6, y: MAINS_AT.y + 24 }} />
          </Figs>
        </g>
        {/* Kept in the top right corner: shifted down by the top crop and in by the side crop. */}
        <g ref={webRef} data-crop="corner">
          <Web />
        </g>
      </motion.g>
      <motion.g data-depth="near" style={{ x: nearX, y: nearY }}>
        <Floor seams={lab} />
        {lab ? (
          <>
            <Bench />
            <Slab placeRef={slabRef} />
            <Figs>
              <g ref={slabFigRef}>
                <Fig n="3" words={FIG_WORDS.slab} dot={SLAB_DOT} leader={`M${SLAB_DOT.x} ${SLAB_DOT.y + 2} V${SLAB_LOW + 62}`} text={{ x: SLAB_DOT.x + 6, y: SLAB_LOW + 72 }} />
              </g>
              <Fig n="4" words={FIG_WORDS.bench} dot={{ x: 1150, y: 507 }} leader="M1150 509 V576" text={{ x: 1156, y: 580 }} className="max-lg:hidden" />
            </Figs>
          </>
        ) : null}
      </motion.g>
    </svg>
  );
}
