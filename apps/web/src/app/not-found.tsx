import type { Metadata } from "next";
import { NOT_FOUND_COPY, NotFoundRoom } from "../components/system/NotFoundRoom";

// The 404 page for any unmatched URL. The root layout adds the footer.
export const metadata: Metadata = {
  title: NOT_FOUND_COPY.docTitle,
};

export default function NotFound() {
  return <NotFoundRoom />;
}
