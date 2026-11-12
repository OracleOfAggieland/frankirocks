import { Corners, Dimension, Ground } from "./Blueprint";

// The 404 drawing: the round slab Franki floats over, seen in elevation, with nobody on it. A dashed
// outline marks where Franki would float (flat-top hair, neck bolts, the scar, big oval eyes, the
// three-lobe hem), with the float's floor shadow dashed on the slab under it. Linework is stitch; the
// empty outline is ink-dim, so the absence is the subject. The outline keeps Franki's idle float
// (±6 px on the 4 s sine, the shadow narrowing as it rises) through CSS loops in system.css that stop
// under reduced motion. Decorative: aria-hidden, no pointer events.
export const SLAB_W = 320;
export const SLAB_H = 260;

/** Franki's silhouette, symmetric about x = 160: flat top, body widest a little below the bolts, three lobes. */
const OUTLINE =
  "M 104 38 Q 104 24 118 24 L 202 24 Q 216 24 216 38 " +
  "C 216 70 222 96 220 120 C 219 136 214 148 210 156 " +
  "Q 193.5 184 177 156 Q 160 184 143 156 Q 126.5 184 110 156 " +
  "C 106 148 101 136 100 120 C 98 96 104 70 104 38 Z";

/** The ragged fringe under the flat top. */
const FRINGE = "M 104 52 L 116 58 L 126 50 L 138 58 L 150 50 L 162 58 L 174 50 L 186 58 L 198 50 L 210 57 L 216 52";

/** The short stitched scar on the forehead, upper right, with two cross-ticks. */
const SCAR = "M 184 68 L 200 63 M 187 63.6 L 189 69.4 M 194.4 61.4 L 196.4 67.2";

export function SlabDrawing() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-drawing="slab"
      viewBox={`0 0 ${SLAB_W} ${SLAB_H}`}
      width={SLAB_W}
      height={SLAB_H}
      className="mat-blueprint pointer-events-none block h-auto w-full"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Corners w={SLAB_W} h={SLAB_H} />

      {/* Centre line, dash-dot, through the slab's axis. */}
      <path d="M 160 12 V 248" strokeDasharray="10 4 2 4" opacity="0.45" />

      {/* The slab: the top face as a full ellipse, the front edge as a band, an engraved ring and a chamfer. */}
      <g data-part="slab">
        <ellipse cx="160" cy="196" rx="120" ry="22" />
        <path d="M 40 196 V 212 A 120 22 0 0 0 280 212 V 196" />
        <path d="M 40 203 A 120 22 0 0 0 280 203" opacity="0.4" />
        <ellipse cx="160" cy="196" rx="96" ry="17" opacity="0.55" />
        <path d="M 154 196 H 166 M 160 192 V 200" />
      </g>

      <Ground y={235} x1={14} x2={306} />

      {/* The float height: hem to slab top, with light extension lines. */}
      <g opacity="0.6">
        <path d="M 222 170 H 304" strokeDasharray="3 3" />
        <path d="M 284 196 H 304" strokeDasharray="3 3" />
      </g>
      <Dimension x1={298} y1={170} x2={298} y2={196} />

      {/* The shadow Franki would cast, dashed on the slab top; it narrows as the outline rises. */}
      <g className="text-ink-dim">
        <ellipse
          data-part="shadow"
          className="sys-floor sys-anim stroke-current"
          cx="160"
          cy="194"
          rx="44"
          ry="6"
          strokeDasharray="4 4"
          opacity="0.4"
        />
      </g>

      {/* Where Franki would float. */}
      <g data-part="absent" className="sys-float sys-anim text-ink-dim">
        <g className="stroke-current" strokeWidth="1.25">
          <path d={OUTLINE} strokeDasharray="6 5" />
          <path d={FRINGE} strokeDasharray="4 4" />
          <rect x="87" y="93" width="12" height="10" rx="2" strokeDasharray="3 3" />
          <rect x="221" y="93" width="12" height="10" rx="2" strokeDasharray="3 3" />
          <ellipse cx="140" cy="96" rx="11" ry="15" strokeDasharray="3 3" />
          <ellipse cx="180" cy="96" rx="11" ry="15" strokeDasharray="3 3" />
        </g>
        <path className="stroke-current" d={SCAR} opacity="0.7" />
      </g>
    </svg>
  );
}
