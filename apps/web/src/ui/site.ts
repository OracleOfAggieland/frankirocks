// The site's identity, shared by the page metadata (app/layout.tsx), the manifest, robots.txt and the sitemap.

export const SITE = {
  name: "Franki",
  /**
   * The deployed web app, App Hosting backend `franki-web`. The base for every absolute URL in the metadata
   * (the canonical link, og:url, the social card). The same origin is in ALLOWED_ORIGINS in
   * packages/server/src/auth/guard.ts.
   */
  url: "https://franki-web--frankirocks.us-central1.hosted.app",
  description: "A friendly Frankenstein ghost you talk to, with one powerful memory for your whole life.",
  author: "Matt Avila",
  locale: "en_US",
} as const;

/**
 * The Open Graph fields every page shares. A page that sets its own `openGraph` replaces the layout's whole
 * object, so it spreads this first. og:title and og:description follow the page's own title and description.
 */
export const SITE_OPEN_GRAPH = {
  type: "website",
  siteName: SITE.name,
  locale: SITE.locale,
} as const;
