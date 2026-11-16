// The X-ray screen's specimens on a page of their own (brief 051 part C), driven by the scripted tracker with no
// camera, so they load fast and keep their WebGL contexts. Development only, like its parent.
import type { Metadata } from "next";
import { XrayViewSection } from "../../_sections/XrayViewSection";

export const metadata: Metadata = { title: "Franki specimens: X-ray screen" };

export default function XrayViewSpecimensPage() {
  return (
    <main data-specimens="xray-view" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 text-left text-ink">
      <h1 className="text-2xl text-ink">Specimens: X-ray screen</h1>
      <XrayViewSection />
    </main>
  );
}
