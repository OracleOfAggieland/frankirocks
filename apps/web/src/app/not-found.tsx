import type { Metadata } from "next";
import { NotFoundRoom } from "../components/system/NotFoundRoom";
import { LANDING } from "../ui/copy-landing";

// The 404 page for any unmatched URL. The root layout adds the footer.
export const metadata: Metadata = {
  title: LANDING.notFound.docTitle,
};

export default function NotFound() {
  return <NotFoundRoom />;
}
