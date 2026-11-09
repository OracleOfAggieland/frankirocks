"use client";
// The avatar slot (lab-ui-foundation R4.1, R4.2, R4.5, R18.1). The only place a renderer is chosen.
// The Main_Screen and the Specimens_Page render <Avatar> only, so a Rive renderer replaces SvgGhost
// here and nowhere else.
import type { AvatarRenderer, AvatarRendererProps } from "../../ui/avatar/types";
import { FrameTimeContext } from "./frame-time";
import { SvgGhost } from "./SvgGhost";

export interface AvatarProps extends AvatarRendererProps {
  renderer?: AvatarRenderer;
  /** The latest Frame_Time, for Electricity. */
  frameTime?: number;
}

export function Avatar({ look, input, renderer: Renderer = SvgGhost, frameTime = 0 }: AvatarProps) {
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
