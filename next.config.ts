import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is off deliberately. Every route in this application is
  // behind authentication and renders per-administrator data read from the
  // session cookie, so there is nothing to prerender or share between users.
  // Leaving it on would mean annotating each page with `instant = false` to say
  // the same thing, and a page that forgot the annotation would fail the build
  // rather than render.
  cacheComponents: false,
  // Partial prefetching depends on Cache Components, so it goes with it.
  partialPrefetching: false,

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  // Security headers for an internal tool. HSTS is added by the TLS terminator
  // in production rather than here, so local HTTP development is unaffected.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
