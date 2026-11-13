// The social card's source: the page that app/opengraph-image.jpg is captured from. It exists only under
// `next dev`, as a child of the Specimens_Page, so scripts/specimens-absent.mjs covers it after every build.
import type { Metadata } from "next";
import { SocialCard } from "./SocialCard";

export const metadata: Metadata = { title: "Franki social card" };

export default function SocialCardPage() {
  return <SocialCard />;
}
