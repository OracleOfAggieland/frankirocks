"use client";
// The avatar slot (lab-ui-foundation R4.1, R4.2, R4.5, R18.1). The only place a renderer is chosen.
// The Main_Screen and the Specimens_Page render <Avatar> only. The default is the three.js ghost
// (brief 013), which draws nothing until the 3D ghost is ready and shows the SVG ghost itself only under
// reduced motion and wherever WebGL 2 can't run; SvgGhost stays available as an explicit renderer.
import type { AvatarRenderer, AvatarRendererProps } from "../../ui/avatar/types";
import { FrameTimeContext } from "./frame-time";
import { ThreeGhost } from "./ThreeGhost";

export interface AvatarProps extends AvatarRendererProps {
  renderer?: AvatarRenderer;
  /** The latest Frame_Time, for Electricity. */
  frameTime?: number;
}

export function Avatar({ look, input, renderer: Renderer = ThreeGhost, frameTime = 0 }: AvatarProps) {
  return (
    <div
      role="img"
      aria-label={look.label}
      data-look={look.name}
      data-ghost={look.ghost ? "true" : "false"}
      data-reduced={input.reducedMotion ? "true" : "false"}
      className="relative w-full"
    >
      <FrameTimeContext.Provider value={frameTime}>
        <Renderer look={look} input={input} />
      </FrameTimeContext.Provider>
    </div>
  );
}
