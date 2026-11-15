import type { NextConfig } from "next";

// Nothing else sets these; one `headers()` entry covers every response.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app renders no third-party HTML, so framing it serves no purpose and
  // only enables clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // Off at the source: `headers()` can add a header but not remove one.
  poweredByHeader: false,

  // TypeScript 7 ships `tsc` and no compiler API, so `next build` has to check
  // types through the CLI. This is the default already, but an experimental
  // one, and with it off the build demands TypeScript 6.
  experimental: { useTypeScriptCli: true },

  // Without this `make mobile` serves a blank page: next dev answers the LAN
  // address's `/_next/*` chunk requests 403. Hostnames only (no scheme/port),
  // `*` is one segment; 172.* is wider than RFC 1918 since there are no ranges.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],

  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // public/ is served `max-age=0`; these change only via `make icons`.
      {
        source: "/:file(favicon.ico|favicon.svg|apple-touch-icon.png|og-card.png|manifest.json)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },

  // Same-origin /api proxy for `make mobile`. Development only: in production
  // the ingress routes /api to Go first, and an ungated rewrite would silently
  // start serving /api if that rule were ever dropped.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/api/:path*", destination: "http://localhost:8080/api/:path*" }];
  },
};

export default nextConfig;
