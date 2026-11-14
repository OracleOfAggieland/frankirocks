import type { Metadata } from "next";
import { GoogleCallback } from "../../../components/google/GoogleCallback";
import { COPY } from "../../../ui/copy";

// Google's window lands here with a code and a state in the address. No referrer leaves this page, and it is never
// indexed. The page itself shows fixed words only.
export const metadata: Metadata = {
  title: COPY.google.callback.title,
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function GoogleCallbackPage() {
  return <GoogleCallback />;
}
