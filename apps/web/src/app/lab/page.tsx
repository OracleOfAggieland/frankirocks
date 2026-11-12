import type { Metadata } from "next";
import { App } from "../../components/App";

export const metadata: Metadata = {
  title: "Franki's lab",
};

export default function Lab() {
  return <App />;
}
