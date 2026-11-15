import type { Metadata, Viewport } from "next";

import { OG_BASE, SITE_NAME, SITE_ORIGIN } from "@/lib/site";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "@/styles/index.css";

export const metadata: Metadata = {
  // Never add a `title`: it sorts ahead of PageTitle's and pins every tab to
  // "Songfolio". Same for app/songs/[id]. See CLAUDE.md, Head assets.
  description: `${SITE_NAME} is a Greek and English song lyrics catalog: browse, search, and collect songs into lists.`,
  // manifest.json rather than .webmanifest: every server knows the .json type.
  manifest: "/manifest.json",
  // .ico first: a browser takes the last entry it supports, so SVG wins where read.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  // Resolves metadata's relative URLs (scrapers need absolute ones) and nothing
  // else. A route's openGraph replaces this block, hence the shared `OG_BASE`.
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
  // Read before any CSS arrives, so the first canvas can already be dark. Both,
  // because the theme is the reader's; html's color-scheme decides from there.
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // lang is the chrome's; SongDetailPage marks each song's own. Change both or
    // neither. suppressHydrationWarning: the theme script edits this element.
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Must run before anything with a background color paints. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant written here, with no input in it. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
