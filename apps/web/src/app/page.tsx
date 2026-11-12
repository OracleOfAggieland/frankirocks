import type { Metadata } from "next";
import { Landing } from "../components/landing/Landing";

export const metadata: Metadata = {
  title: "Franki: your whole life, stitched together",
};

export default function Home() {
  return <Landing />;
}
