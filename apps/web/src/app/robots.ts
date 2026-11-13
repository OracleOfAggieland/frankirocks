import type { MetadataRoute } from "next";
import { SITE } from "../ui/site";

// robots.txt: the pages are open to crawlers, the API routes are not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
