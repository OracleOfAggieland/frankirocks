// The Specimens_Page (lab-ui-foundation R20). A plain Server Component that renders client sections
// with Fixture props. It exists only under `next dev`: next.config.ts adds the `dev.tsx` page extension
// only in PHASE_DEVELOPMENT_SERVER, so a production build has no /specimens route. No Server Action,
// `use cache`, `next/og`, ISR or /api/ call.
import type { Metadata } from "next";
import { AvatarSection } from "./_sections/AvatarSection";
import { SurfaceSections } from "./_sections/SurfaceSections";

export const metadata: Metadata = { title: "Franki specimens" };

export default function SpecimensPage() {
  return (
    <main data-specimens="" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 text-left text-ink">
      <h1 className="text-2xl text-ink">Specimens</h1>
      <p className="text-sm text-ink-dim">Every surface in every state, with example props. Development only.</p>
      <AvatarSection />
      <SurfaceSections />
    </main>
  );
}
