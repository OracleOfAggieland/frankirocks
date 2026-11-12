"use client";
// The audio source for renderers that act on the sound itself (brief 013, design note §2.4 D1). Carried by
// context, as FrameTimeContext is, so the Avatar_Contract props stay the Avatar_Look and the Avatar_Input.
// Null means no source: the three.js renderer then reads silence. SvgGhost ignores it.
import { createContext, useContext } from "react";
import type { AvatarAudioSource } from "../../ui/levels/audio-source";

export const AvatarAudioContext = createContext<AvatarAudioSource | null>(null);

export function useAvatarAudio(): AvatarAudioSource | null {
  return useContext(AvatarAudioContext);
}
