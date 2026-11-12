import type { Metadata } from "next";
import { Landing } from "../components/landing/Landing";

export const metadata: Metadata = {
  title: "Franki: your whole life, stitched together",
  description:
    "Franki is a friendly Frankenstein ghost you talk to. One powerful memory system joins your inbox, calendar, meals and money, and helps you win at life.",
};

export default function Home() {
  return <Landing />;
}
