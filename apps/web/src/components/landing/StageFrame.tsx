// The front door's stage chrome (brief 015, package H2): what appears with the equipment. A rounded-frame edge
// in blueprint linework with registration ticks at its four corners and quarter marks along the top and bottom
// edges, the fig label in the top left, and the brass "Sample data" plate in the top right. The edge and ticks
// are decoration: hidden from assistive tech and taking no pointer events. The plate's words stay readable.
// Everything fades in and out with the equipment; under reduced motion that fade is the only movement.
import { FigLabel } from "../lab/FigLabel";
import { Plate } from "../lab/Plate";
import { LANDING } from "../../ui/copy-landing";

export interface StageFrameProps {
  /** The edge and ticks. */
  frame: boolean;
  /** The "Sample data" plate. */
  plate: boolean;
  fig: { n: string; text: string } | null;
}

const CORNERS = ["tl", "tr", "bl", "br"] as const;
const QUARTERS = [25, 50, 75] as const;

export function StageFrame({ frame, plate, fig }: StageFrameProps) {
  return (
    <div data-stage-frame="" data-on={frame ? "true" : "false"} className="demo-frame pointer-events-none absolute inset-0">
      <div aria-hidden="true" data-frame-edge="" className="demo-frame-edge absolute inset-0 rounded-frame">
        {CORNERS.map((c) => (
          <span key={c} data-tick={c} className={`demo-tick demo-tick-${c} absolute`} />
        ))}
        {QUARTERS.map((q) => (
          <span key={`t${q}`} className="demo-mark absolute top-0" style={{ left: `${q}%` }} />
        ))}
        {QUARTERS.map((q) => (
          <span key={`b${q}`} className="demo-mark absolute bottom-0" style={{ left: `${q}%` }} />
        ))}
      </div>
      {fig !== null ? (
        <span key={fig.n + fig.text} aria-hidden="true" data-demo-fig="" className="demo-fig absolute">
          <FigLabel n={fig.n} side="right">
            {fig.text}
          </FigLabel>
        </span>
      ) : null}
      <span data-demo-plate="" data-on={plate ? "true" : "false"} aria-hidden={plate ? undefined : true} className="demo-plate absolute">
        <Plate>{LANDING.stage.plate}</Plate>
      </span>
    </div>
  );
}
