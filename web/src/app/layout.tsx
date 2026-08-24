import type { Metadata, Viewport } from "next";

import { OG_BASE, SITE_NAME, SITE_ORIGIN } from "@/lib/site";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "@/styles/index.css";

export const metadata: Metadata = {
  // No `title`, deliberately, and it is not an omission to correct: every route
  // sets its own through PageTitle, and a title declared here is rendered by
  // this layout — above every one of them — so it is the one `document.title`
  // reads and every tab in the app says "Songfolio". index.html could carry one
  // because it was not React's to order. PageTitle's comment has the mechanism.
  //
  // What is given up is a title in the server HTML for a reader that runs no
  // JavaScript, which today is a reader that also gets no content: the app is
  // client-rendered. `og:title` below is what link previews read and is
  // unaffected. The rule holds for the routes that *do* server-render, too, and
  // for the same reason: app/songs/[id] declares no title either — a metadata
  // title from any segment above a route wins the read and then never moves,
  // since react-router does every in-app navigation from there on.
  description: `${SITE_NAME} is a Greek and English song lyrics catalog: browse, search, and collect songs into lists.`,
  // manifest.json, not the spec's preferred site.webmanifest extension. Every
  // mime table knows .json and browsers parse a manifest regardless of its
  // media type, so the two deployment stacks agree by construction rather than
  // by a config special case on whichever one is observable.
  manifest: "/manifest.json",
  // The .ico goes FIRST and the SVG second: among the entries it supports a
  // browser takes the last one, so this order gives the vector to everything
  // that reads SVG and leaves the raster as the fallback it is meant to be.
  // Reversed, the crisp icon is the one that never gets used.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  // Link previews, for the domain being handed around. og:description opens
  // differently from the meta description above on purpose — the card already
  // carries the name in og:title, so it does not repeat it.
  //
  // The image URL must be absolute: a card is fetched by a server with no page
  // context to be relative to, and most scrapers do not resolve a relative one.
  // This is what resolves the relative URLs below against the origin — and it
  // resolves nothing outside metadata, which is why the sitemap and a song's
  // JSON-LD read `SITE_ORIGIN` themselves. `OG_BASE` is the site name and the
  // card together, spread first because a route's own openGraph replaces this
  // whole block rather than merging into it; `lib/site.ts` says why.
  metadataBase: new URL(SITE_ORIGIN),
  openGraph: {
    ...OG_BASE,
    type: "website",
    url: "/",
    title: SITE_NAME,
    description:
      "A Greek and English song lyrics catalog: browse, search, and collect songs into lists.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout extend under the notch and home indicator; the safe-area
  // insets in styles/index.css keep content clear of them.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // lang is the language of the *chrome*, which is English throughout:
    // "Browse", "Sign in", "No users matched.". The Greek is content, and a
    // song's lyrics carry no lang of their own — so a screen reader picks its
    // voice from here, and `el` had it pronouncing the whole interface as
    // Greek. SongDetailPage marks the song's own lang on the title and lyrics.
    //
    // suppressHydrationWarning is for the script below: it puts a class on this
    // element before React hydrates, so the client's markup legitimately
    // differs from the server's.
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Ahead of everything that has a background color to get wrong, which
            is what matters rather than being literally first: Next puts an
            empty `<div hidden>` for its streamed metadata above this, and an
            element with nothing in it paints nothing. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
