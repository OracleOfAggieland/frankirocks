// The live test runner (brief 050 part B, item 7). It exists only under `next dev`: next.config.ts adds the
// `dev.tsx` page extension only in PHASE_DEVELOPMENT_SERVER, so a production build has no /live-test route.
// A page for a second window: one step at a time, read from across a desk. No avatar, no call.
import type { Metadata } from "next";
import { Runner } from "./_runner/Runner";

export const metadata: Metadata = { title: "Franki live test" };

export default function LiveTestPage() {
  return <Runner />;
}
