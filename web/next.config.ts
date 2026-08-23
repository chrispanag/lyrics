import type { NextConfig } from "next";

// The three headers web/nginx.conf used to add, which nothing else sets now
// that the app is served by Next rather than by nginx. They were repeated in
// every nginx location block because `add_header` does not merge across
// levels; here one entry covers every response, which is the whole reason
// that duplication is gone.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app renders no third-party HTML, so framing it serves no purpose and
  // only enables clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // `X-Powered-By: Next.js` otherwise goes out on every document. nginx never
  // advertised what was behind it and there is no reason to start; the header
  // is off here rather than stripped in `headers()` below, which can add but
  // not remove.
  poweredByHeader: false,

  // What `make mobile` needs to work at all, and the failure without it is
  // total rather than partial. Next blocks cross-origin requests to `/_next/*`
  // in development, and `next dev -H 0.0.0.0` does not put this machine's LAN
  // address on the allowlist — only `localhost` and the bound hostname are on
  // it, and the bound hostname is `0.0.0.0`. Some of the app's own script tags
  // carry `crossorigin`, so their fetches send an `Origin` header and are
  // answered 403: opening `http://<lan-ip>:5173` on a phone loads the document,
  // fails three chunks including `AppRoot`, and leaves a blank page with an
  // untitled tab. Verified against this server, both ways round.
  //
  // The entries are hostnames — no scheme, no port — matched segment by segment
  // with `*` standing for one segment, so these are the private ranges a phone
  // and a laptop share, plus the mDNS name Bonjour gives this machine. RFC 1918
  // reserves 172.16–31 rather than all of 172, and the matcher has no numeric
  // ranges to say so; the wider pattern is accepted because this list is read
  // only by `next dev`, where it decides which *other* private host may read
  // dev assets and nothing else.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],

  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Next serves everything in public/ as `max-age=0`, so the icons and the
      // manifest revalidate on every cold load — where the static-site deploy
      // this replaced had a CDN in front of them. They are addressed by a name
      // that never changes and are replaced only by `make icons`, so a day is
      // safe and a stale one costs nothing anybody would notice.
      {
        source: "/:file(favicon.ico|favicon.svg|apple-touch-icon.png|og-card.png|manifest.json)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },

  // The dev-server proxy that vite.config.ts used to declare. Only requests
  // the client sends same-origin come through here, which is what `make
  // mobile` arranges by clearing NEXT_PUBLIC_API_BASE_URL: a phone then talks
  // to one origin and reaches the API over loopback, exactly as the deployed
  // app talks to one origin. `make web` keeps calling :8080 directly and never
  // uses this.
  //
  // Development only, and deliberately so: in production the App Platform
  // ingress routes /api to the Go service before Next ever sees the request,
  // so a rewrite here would be dead config that looks live — and worse, would
  // quietly become the thing serving /api if that ingress rule were ever
  // dropped.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/api/:path*", destination: "http://localhost:8080/api/:path*" }];
  },
};

export default nextConfig;
