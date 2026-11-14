// The Specimens_Page (lab-ui-foundation R20). A plain Server Component that renders client sections
// with Fixture props. It exists only under `next dev`: next.config.ts adds the `dev.tsx` page extension
// only in PHASE_DEVELOPMENT_SERVER, so a production build has no /specimens route. No Server Action,
// `use cache`, `next/og`, ISR or /api/ call.
import type { Metadata } from "next";
import { AvatarSection } from "./_sections/AvatarSection";
import { BankSection } from "./_sections/BankSection";
import { CallScreenSection } from "./_sections/CallScreenSection";
import { CardExtrasSection } from "./_sections/CardExtrasSection";
import { ControlsSection } from "./_sections/ControlsSection";
import { ErrandSection } from "./_sections/ErrandSection";
import { InstrumentExtrasSection } from "./_sections/InstrumentExtrasSection";
import { MainScreenSection } from "./_sections/MainScreenSection";
import { MemoryScreenSection } from "./_sections/MemoryScreenSection";
import { MaterialsSection } from "./_sections/MaterialsSection";
import { MemoryExtrasSection } from "./_sections/MemoryExtrasSection";
import { PhoneSection } from "./_sections/PhoneSection";
import { RadioSection } from "./_sections/RadioSection";
import { SurfaceSections } from "./_sections/SurfaceSections";
import { ThreeSection } from "./_sections/ThreeSection";
import { VisitSection } from "./_sections/VisitSection";

export const metadata: Metadata = { title: "Franki specimens" };

export default function SpecimensPage() {
  return (
    <main data-specimens="" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 text-left text-ink">
      <h1 className="text-2xl text-ink">Specimens</h1>
      <p className="text-sm text-ink-dim">Every surface in every state, with example props. Development only.</p>
      <AvatarSection />
      <ThreeSection />
      <MainScreenSection />
      <MemoryScreenSection />
      <VisitSection />
      <PhoneSection />
      <RadioSection full={false} />
      <BankSection />
      <ErrandSection />
      <MaterialsSection />
      <SurfaceSections />
      <CardExtrasSection />
      <MemoryExtrasSection />
      <InstrumentExtrasSection />
      <ControlsSection />
      <CallScreenSection />
    </main>
  );
}
