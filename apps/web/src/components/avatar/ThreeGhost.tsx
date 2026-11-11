"use client";
// The three.js renderer behind the Avatar_Contract (brief 013, design note §4.3), written in WP12: an SVG layer and
// a canvas layer in one box that never changes size, driven by one ThreeGhostController per mount.
// Scaffold (not ported yet): until WP12 lands it renders the SVG ghost, so pages that use it already render.
import type { AvatarRenderer, AvatarRendererProps } from "../../ui/avatar/types";
import { SvgGhost } from "./SvgGhost";
import { type ThreeHostDeps, browserThreeHost } from "./three-host";

/** One renderer per dependency factory; the specimens page builds its own with a budget per tile. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- scaffold: WP12 builds a controller per mount from makeDeps()
export function createThreeGhost(makeDeps: () => ThreeHostDeps = browserThreeHost): AvatarRenderer {
  return function ThreeGhostScaffold({ look, input }: AvatarRendererProps) {
    return <SvgGhost look={look} input={input} />;
  };
}

export const ThreeGhost: AvatarRenderer = createThreeGhost(browserThreeHost);
