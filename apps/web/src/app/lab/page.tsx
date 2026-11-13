import type { Metadata } from "next";
import { App } from "../../components/App";

// No openGraph of its own: an object here would replace the layout's, social card included.
export const metadata: Metadata = {
  title: "Franki's lab",
  alternates: { canonical: "/lab" },
};

export default function Lab() {
  return <App />;
}
