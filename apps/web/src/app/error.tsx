"use client";

import { useEffect } from "react";
import { FuseRoom } from "../components/system/FuseRoom";
import { LANDING } from "../ui/copy-landing";

// The error boundary for every page under the root layout. `retry` fetches and renders the segment again.
// The thrown value goes to the browser console only; the page shows no internals.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <title>{LANDING.error.docTitle}</title>
      <FuseRoom onRetry={retry} />
    </>
  );
}
