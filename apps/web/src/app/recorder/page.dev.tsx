// The judge spike recorder page (brief 006 item 3). It exists only under `next dev`, by the same mechanism as the
// Specimens_Page: next.config.ts adds the `dev.tsx` page extension only in PHASE_DEVELOPMENT_SERVER, so a
// production build has no /recorder route, and scripts/specimens-absent.mjs proves it after every build.
import type { Metadata } from "next";
import { Recorder } from "./_recorder/Recorder";

export const metadata: Metadata = { title: "Franki recorder" };

export default function RecorderPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8 text-left text-ink">
      <h1 className="text-2xl text-ink">Judge spike recorder</h1>
      <p className="text-sm text-ink-dim">
        Read each line once, the way you would say it to Franki. Takes are saved to scripts/judge-spike/audio/owner and never committed.
        Record any lines you like. Development only.
      </p>
      <Recorder />
    </main>
  );
}
