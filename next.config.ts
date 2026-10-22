import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is off deliberately. Every route in this application is
  // behind authentication and renders per-administrator data read from the
  // session cookie, so there is nothing to prerender or share between users.
  // Leaving it on would mean annotating each page with `instant = false` to say
  // the same thing, and a page that forgot the annotation would fail the build
  // rather than render.
  // Lets a page call forbidden()/unauthorized() so a permission denial renders
  // the matching UI with a 403/401 status, instead of surfacing as a 500 that
  // monitoring would read as a server fault.
  experimental: { authInterrupts: true },

  cacheComponents: false,
  // Partial prefetching depends on Cache Components, so it goes with it.
  partialPrefetching: false,

  /**
   * Loaded from node_modules at runtime rather than bundled.
   *
   * PGlite locates its `.wasm` and `.data` relative to its own module URL. Once
   * the bundler rewrites it into a chunk that anchor moves, and its loader ends
   * up calling `fs.readFile` with a URL object that Node rejects —
   * ERR_INVALID_ARG_TYPE, and no database. Left external, it resolves its
   * assets the way it expects to.
   */
  serverExternalPackages: ["@electric-sql/pglite"],

  /**
   * Files the serverless bundle needs but tracing cannot infer.
   *
   * Next follows `import` statements to decide what to ship. Two things the
   * embedded database depends on are invisible to that:
   *
   * `prisma/migrations/**` is read with `fs` at runtime, from paths built at
   * runtime, so nothing links to it statically. Omitted, the embedded database
   * starts with no tables and every page fails on a missing relation.
   *
   * PGlite's `.wasm` and `.data` are fetched by its loader rather than
   * imported. Omitted, PostgreSQL itself is missing and nothing starts.
   *
   * Only these functions touch the database path, so the ~24MB is not attached
   * to every route.
   */
  outputFileTracingIncludes: {
    "/admin/**": [
      "./prisma/migrations/**/*.sql",
      "./node_modules/@electric-sql/pglite/dist/*.wasm",
      "./node_modules/@electric-sql/pglite/dist/*.data",
    ],
    "/api/**": [
      "./prisma/migrations/**/*.sql",
      "./node_modules/@electric-sql/pglite/dist/*.wasm",
      "./node_modules/@electric-sql/pglite/dist/*.data",
    ],
  },

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
