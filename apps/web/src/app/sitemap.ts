import type { MetadataRoute } from "next";
import { SITE } from "../ui/site";

// sitemap.xml: the two pages, the front door and the lab. No lastModified, so no clock read.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE.url}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE.url}/lab`, changeFrequency: "weekly", priority: 0.5 },
  ];
}
