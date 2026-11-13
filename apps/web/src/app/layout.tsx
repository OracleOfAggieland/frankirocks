import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { Footer } from "../components/Footer";
import { SpiderCursor } from "../components/cursor/SpiderCursor";
import { COLOR } from "../ui/motion";
import { SITE, SITE_OPEN_GRAPH } from "../ui/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display type for the front door and the 404 and error pages. Variable weight, with the soft, wonk and
// optical-size axes; italic for the one italic word a headline may carry.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: "variable",
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK", "opsz"],
});

// The social card (opengraph-image.jpg), the icons (icon.svg, apple-icon.png, favicon.ico) and the manifest are
// file conventions in this folder; Next adds their tags.
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: SITE.name,
  description: SITE.description,
  applicationName: SITE.name,
  authors: [{ name: SITE.author }],
  creator: SITE.author,
  openGraph: SITE_OPEN_GRAPH,
  twitter: { card: "summary_large_image" },
  appleWebApp: { title: SITE.name, statusBarStyle: "black-translucent" },
  // Phone numbers, amounts and addresses on screen stay plain text, not links iOS adds on its own.
  formatDetection: { telephone: false, email: false, address: false },
};

// The browser chrome and the overscroll take the lab's night colour; the page is dark only.
export const viewport: Viewport = {
  themeColor: COLOR["night-0"],
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-night-0 text-ink font-sans">
        {children}
        <SpiderCursor />
        <Footer />
      </body>
    </html>
  );
}
