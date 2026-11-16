// The X-ray's specimens on a page of their own (brief 051 part D): the whole thing walked beside the ghost, the real
// store by hand (the real camera, or the real tracker on a still picture), and the machine's short section, with links
// to the machine in each state and the screen in each signal. Eight WebGL contexts at most. Development only, like
// its parent.
import type { Metadata } from "next";
import { XraySection } from "../_sections/XraySection";

export const metadata: Metadata = { title: "Franki specimens: X-ray" };

export default function XraySpecimensPage() {
  return (
    <main data-specimens="xray" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 text-left text-ink">
      <h1 className="text-2xl text-ink">Specimens: X-ray</h1>
      <XraySection full />
    </main>
  );
}
