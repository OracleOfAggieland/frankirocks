// The radio's specimens on a page of their own (brief 047): the radio on the stage and its globe, without the
// rest of the Specimens_Page, so they load fast and keep their WebGL contexts. Development only, like its parent.
import type { Metadata } from "next";
import { RadioSection } from "../_sections/RadioSection";

export const metadata: Metadata = { title: "Franki specimens: radio" };

export default function RadioSpecimensPage() {
  return (
    <main data-specimens="radio" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 text-left text-ink">
      <h1 className="text-2xl text-ink">Specimens: radio</h1>
      <RadioSection full />
    </main>
  );
}
