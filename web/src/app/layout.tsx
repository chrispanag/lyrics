import type { Metadata, Viewport } from "next";

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
  // unaffected. Per-route titles come back into the HTML with SSR, as
  // generateMetadata on the routes that get server-rendered.
  description:
    "Songfolio is a Greek and English song lyrics catalog: browse, search, and collect songs into lists.",
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
  // context to be relative to, and most scrapers do not resolve a relative
  // one. So the origin is written out here, as it is in `url` below and in
  // icons/og-card.svg, which bakes the domain into the picture — a rename has
  // to visit all three. It is deployment identity rather than a build input,
  // unlike NEXT_PUBLIC_API_BASE_URL, which is left unset so the bundle calls
  // its own origin at runtime.
  metadataBase: new URL("https://songfolio.live"),
  openGraph: {
    type: "website",
    siteName: "Songfolio",
    url: "/",
    title: "Songfolio",
    description:
      "A Greek and English song lyrics catalog: browse, search, and collect songs into lists.",
    images: [
      {
        url: "/og-card.png",
        type: "image/png",
        width: 1200,
        height: 630,
        alt: "Songfolio — a Greek and English song lyrics catalog",
      },
    ],
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
