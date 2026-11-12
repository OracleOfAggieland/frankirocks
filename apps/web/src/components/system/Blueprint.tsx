// Shared blueprint pieces for the 404 and error drawings: registration marks at the four corners of a
// drawing, a dimension line with end ticks, and a ground line that fades out at both ends.
// All of it is stitch linework inside an aria-hidden svg.

/** L-shaped registration marks, 10 units long, inset 4 units from each corner of a w by h drawing. */
export function Corners({ w, h }: { w: number; h: number }) {
  const i = 4;
  const l = 10;
  return (
    <g data-part="corners" opacity="0.7">
      <path d={`M ${i} ${i + l} V ${i} H ${i + l}`} />
      <path d={`M ${w - i - l} ${i} H ${w - i} V ${i + l}`} />
      <path d={`M ${i} ${h - i - l} V ${h - i} H ${i + l}`} />
      <path d={`M ${w - i - l} ${h - i} H ${w - i} V ${h - i - l}`} />
    </g>
  );
}

/** A dimension line from (x1, y1) to (x2, y2), axis-aligned, with short ticks across each end. */
export function Dimension({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const vertical = x1 === x2;
  const t = 4;
  const tick = (x: number, y: number) => (vertical ? `M ${x - t} ${y} H ${x + t}` : `M ${x} ${y - t} V ${y + t}`);
  // Small open arrowheads pointing outward to each end.
  const a = 3;
  const heads = vertical
    ? `M ${x1 - a} ${y1 + a * 1.6} L ${x1} ${y1} L ${x1 + a} ${y1 + a * 1.6} M ${x2 - a} ${y2 - a * 1.6} L ${x2} ${y2} L ${x2 + a} ${y2 - a * 1.6}`
    : `M ${x1 + a * 1.6} ${y1 - a} L ${x1} ${y1} L ${x1 + a * 1.6} ${y1 + a} M ${x2 - a * 1.6} ${y2 - a} L ${x2} ${y2} L ${x2 - a * 1.6} ${y2 + a}`;
  return (
    <g data-part="dimension" opacity="0.8">
      <path d={`M ${x1} ${y1} L ${x2} ${y2}`} />
      <path d={`${tick(x1, y1)} ${tick(x2, y2)}`} />
      <path d={heads} />
    </g>
  );
}

/** A horizontal ground line: solid in the middle, broken into shorter dashes toward both ends. */
export function Ground({ y, x1, x2 }: { y: number; x1: number; x2: number }) {
  const span = x2 - x1;
  const inner = span * 0.14;
  return (
    <g data-part="ground">
      <path d={`M ${x1 + inner} ${y} H ${x2 - inner}`} />
      <path d={`M ${x1} ${y} H ${x1 + inner - 4}`} strokeDasharray="2 4" opacity="0.6" />
      <path d={`M ${x2 - inner + 4} ${y} H ${x2}`} strokeDasharray="2 4" opacity="0.6" />
    </g>
  );
}
