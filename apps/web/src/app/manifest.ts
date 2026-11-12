import type { MetadataRoute } from "next";
import { COLOR } from "../ui/motion";

// The web app manifest: names, the lab's night colour, and Franki's head as the icon (app/icon.svg).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Franki",
    short_name: "Franki",
    description: "An avatar-first, voice-first assistant for your whole life.",
    start_url: "/",
    display: "standalone",
    background_color: COLOR["night-0"],
    theme_color: COLOR["night-0"],
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
