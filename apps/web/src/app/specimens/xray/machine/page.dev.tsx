// The X-ray machine on the stage in each state (brief 051 part B, placed by part D): the walk beside the ghost, the
// machine alone in each state five at a time, still under Reduced_Motion at a switch, and the no-WebGL words. Seven
// WebGL contexts at most. Development only, like its parent.
import type { Metadata } from "next";
import { XrayPropSection } from "../../_sections/XrayPropSection";

export const metadata: Metadata = { title: "Franki specimens: X-ray machine" };

export default function XrayMachineSpecimensPage() {
  return (
    <main data-specimens="xray-machine" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 text-left text-ink">
      <h1 className="text-2xl text-ink">Specimens: X-ray machine</h1>
      <XrayPropSection full />
    </main>
  );
}
