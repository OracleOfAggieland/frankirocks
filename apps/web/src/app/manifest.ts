import type { MetadataRoute } from "next";
import { COLOR } from "../ui/motion";
import { SITE } from "../ui/site";

// The web app manifest: names, the lab's night colour, and Franki's head as the icon. app/icon.svg is the source;
// the PNGs in public/icons are rasterized from it, the maskable one with the head inside the central safe circle.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE.name,
    short_name: SITE.name,
    description: "An avatar-first, voice-first assistant for your whole life.",
    lang: "en",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: COLOR["night-0"],
    theme_color: COLOR["night-0"],
    categories: ["lifestyle", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
