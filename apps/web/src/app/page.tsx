import type { Metadata } from "next";
import { Landing } from "../components/landing/Landing";
import { SITE_OPEN_GRAPH } from "../ui/site";

export const metadata: Metadata = {
  title: "Franki: your whole life, stitched together",
  description:
    "Franki is a friendly Frankenstein ghost you talk to. One powerful memory system joins your health, finances, and productivity, and helps you win at life.",
  alternates: { canonical: "/" },
  openGraph: { ...SITE_OPEN_GRAPH, url: "/" },
};

export default function Home() {
  return <Landing />;
}
