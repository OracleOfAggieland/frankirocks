"use client";
// The latest Frame_Time, for renderers that draw Electricity. Carried by context so the
// Avatar_Contract props stay the Avatar_Look and the Avatar_Input.
import { createContext, useContext } from "react";

export const FrameTimeContext = createContext<number>(0);

export function useFrameTime(): number {
  return useContext(FrameTimeContext);
}
