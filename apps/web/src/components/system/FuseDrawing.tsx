import { Corners, Dimension, Ground } from "./Blueprint";

// The error drawing: a glass cartridge fuse held in two spring clips on a base block, seen from the
// side. Everything is stitch linework except the break: the filament is melted through in the middle,
// its two ends curled back with beads of metal, a little spatter on the glass and a faint scorch, all
// in ember. Light on the glass and the end caps is drawn as thin ink-dim highlight lines. The break
// fades in once after the drawing rises; the scorch then cools slowly on a drift loop that stops under
// reduced motion. No electricity: nothing is working. Decorative: aria-hidden, no pointer events.
export const FUSE_W = 320;
export const FUSE_H = 200;

/** Filter id for the soft ember glow behind the break. One fuse drawing per page. */
export const FUSE_GLOW_ID = "franki-fuse-glow";

/** One end cap, outer end rounded, as a path; `x0` is the outer end and `x1` the end on the glass. */
function capPath(x0: number, x1: number) {
  const dir = x1 > x0 ? 1 : -1;
  const r = 8;
  return `M ${x1} 78 H ${x0 + dir * r} Q ${x0} 78 ${x0} 86 V 106 Q ${x0} 114 ${x0 + dir * r} 114 H ${x1} Z`;
}

/** A spring clip seen from the side: two strips up from a foot, hidden behind the cap, tips curling out above it. */
function Clip({ a, b }: { a: number; b: number }) {
  return (
    <g data-part="clip">
      <path d={`M ${a} 132 V 114 M ${b} 132 V 114`} />
      <path d={`M ${a} 78 Q ${a - 1} 71 ${a - 7} 68 M ${b} 78 Q ${b + 1} 71 ${b + 7} 68`} />
      <rect x={a - 4} y="132" width={b - a + 8} height="4" rx="1" />
    </g>
  );
}

const HOT_LEFT = "M 144 97.6 C 148 97.8 151 96.6 150.6 94";
const HOT_RIGHT = "M 178 94.8 C 174 94.6 171 96 171.6 98.6";
const SPATTER: readonly (readonly [number, number])[] = [
  [157, 89.5],
  [164, 101.5],
  [160.5, 86.8],
  [166.5, 91],
  [155, 100.5],
];

export function FuseDrawing() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-drawing="fuse"
      viewBox={`0 0 ${FUSE_W} ${FUSE_H}`}
      width={FUSE_W}
      height={FUSE_H}
      className="mat-blueprint pointer-events-none block h-auto w-full"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <filter id={FUSE_GLOW_ID} x="-60%" y="-120%" width="220%" height="340%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      <Corners w={FUSE_W} h={FUSE_H} />

      {/* Overall length, with dashed extension lines from the caps' ends. */}
      <g opacity="0.55">
        <path d="M 50 74 V 40 M 270 74 V 40" strokeDasharray="3 3" />
      </g>
      <Dimension x1={50} y1={46} x2={270} y2={46} />

      {/* The base block, its chamfer and two terminal screws. */}
      <g data-part="base">
        <rect x="28" y="136" width="264" height="30" rx="5" />
        <path d="M 33 141 H 287" opacity="0.45" />
        <circle cx="46" cy="151" r="6" />
        <path d="M 42 147 L 50 155" />
        <circle cx="274" cy="151" r="6" />
        <path d="M 270 155 L 278 147" />
      </g>
      <Ground y={176} x1={10} x2={310} />

      <Clip a={60} b={82} />
      <Clip a={238} b={260} />

      {/* The cartridge: two end caps with crimp rings, and the glass tube between them. */}
      <g data-part="fuse">
        <path d={capPath(50, 92)} />
        <path d={capPath(270, 228)} />
        <path d="M 84 79 V 113 M 88 79 V 113 M 232 79 V 113 M 236 79 V 113" opacity="0.6" />
        <path d="M 92 81 H 228 M 92 111 H 228" />
        <path d="M 92 96 C 112 96 130 96.8 144 97.6 M 228 96 C 210 96 192 95.4 178 94.8" />
      </g>

      {/* Light: a lit top edge on each cap, two reflections along the glass, a faint one low on the far side. */}
      <g data-part="light" className="stroke-ink-dim">
        <path d="M 56 83 H 82 M 238 83 H 264" opacity="0.35" />
        <path d="M 100 86.5 H 146" opacity="0.45" />
        <path d="M 178 86.5 H 196" opacity="0.35" />
        <path d="M 150 106 H 220" opacity="0.2" />
      </g>

      {/* The break. */}
      <g data-part="break" className="sys-break sys-anim">
        <ellipse className="sys-ember sys-anim fill-ember stroke-none" cx="161" cy="92" rx="22" ry="9" opacity="0.14" filter={`url(#${FUSE_GLOW_ID})`} />
        <path className="stroke-ember" d={`${HOT_LEFT} ${HOT_RIGHT}`} strokeWidth="3" opacity="0.5" filter={`url(#${FUSE_GLOW_ID})`} />
        <path className="stroke-ember" d={`${HOT_LEFT} ${HOT_RIGHT}`} strokeWidth="1.25" />
        <circle className="fill-ember stroke-none" cx="150.4" cy="93.2" r="1.8" />
        <circle className="fill-ember stroke-none" cx="171.8" cy="99.4" r="1.8" />
        {SPATTER.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} className="fill-ember stroke-none" cx={cx} cy={cy} r="0.9" opacity="0.7" />
        ))}
      </g>
    </svg>
  );
}
