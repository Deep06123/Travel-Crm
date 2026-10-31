import type { NextConfig } from "next";

/**
 * Origins a Server Action is allowed to be invoked from.
 *
 * Next compares the request's Origin against its Host and rejects the action
 * when they disagree — a CSRF defence that fires on a legitimate request too,
 * whenever a reverse proxy rewrites one and not the other. On a Hostinger VPS
 * nginx sits in front, so the deployment's own origin is named here as well.
 *
 * Read at build time, which is when `output: "standalone"` freezes this file
 * into the bundle: AUTH_URL must be set for the build, not only for the
 * process that serves it.
 */
function serverActionOrigins(): string[] {
  const origins = ["localhost:3000", "127.0.0.1:3000"];
  const authUrl = process.env.AUTH_URL;

  if (!authUrl) return origins;

  try {
    // `host`, not `hostname`: a non-default port is part of the comparison.
    origins.push(new URL(authUrl).host);
  } catch {
    // A malformed AUTH_URL is already a startup failure in src/lib/env.ts,
    // with a far better message than a build crash here would give.
  }

  return origins;
}

const nextConfig: NextConfig = {
  /**
   * Self-contained server bundle at `.next/standalone`.
   *
   * Written for the Hostinger VPS. `next start` needs the whole dependency
   * tree resident — around 1 GB of node_modules, most of it build-time only —
   * on a box whose smallest useful plan has 8 GB of disk and 2 GB of RAM. The
   * standalone output traces what the server actually imports and copies just
   * that, so the running host carries the server and not the toolchain that
   * produced it, and a release can be built elsewhere and shipped as a tarball.
   *
   * `next start` keeps working from a normal checkout; this output is
   * additional, not a replacement.
   */
  output: "standalone",

  // Cache Components is off deliberately. Every route in this application is
  // behind authentication and renders per-administrator data read from the
  // session cookie, so there is nothing to prerender or share between users.
  // Leaving it on would mean annotating each page with `instant = false` to say
  // the same thing, and a page that forgot the annotation would fail the build
  // rather than render.
  // Lets a page call forbidden()/unauthorized() so a permission denial renders
  // the matching UI with a 403/401 status, instead of surfacing as a 500 that
  // monitoring would read as a server fault.
  experimental: {
    authInterrupts: true,

    serverActions: {
      /**
       * Raised from Next's 1 MB default to match what the application itself
       * allows. `document-service.ts` caps an upload at 25 MB, and the upload
       * form is a Server Action, so the two limits have to agree: at the
       * default, every document over 1 MB failed before the service's own
       * limit was ever consulted — and failed as a generic body-size error
       * rather than the readable "file is too large" the form knows how to
       * show.
       *
       * nginx needs the matching `client_max_body_size` (see deploy/nginx.conf)
       * or it rejects the request a layer earlier, with a 413 the application
       * never sees.
       */
      bodySizeLimit: "25mb",
      allowedOrigins: serverActionOrigins(),
    },
  },

  cacheComponents: false,
  // Partial prefetching depends on Cache Components, so it goes with it.
  partialPrefetching: false,

  /**
   * Loaded from node_modules at runtime rather than bundled.
   *
   * The mariadb connector resolves parts of itself dynamically and is a native
   * network client with no business being rewritten into a route chunk. Marking
   * it external is also what Prisma documents for driver adapters.
   */
  serverExternalPackages: ["@prisma/adapter-mariadb", "mariadb"],

  turbopack: {
    /**
     * Tailwind runs on the one stylesheet that imports it, and nothing else.
     *
     * The pattern was `*.css`, which matched every stylesheet in the graph —
     * including the CSS this loader had just emitted. Turbopack fed that output
     * back in, Tailwind compiled it again, and the new result invalidated the
     * previous one: in development that was an endless "Fast Refresh
     * rebuilding", each round ending in a full page reload, several times a
     * second, with no file having changed. It made the application look like it
     * was refreshing on its own and it broke every browser test, because a form
     * cannot be submitted on a page that keeps reloading underneath it.
     *
     * `globals.css` is the only file that says `@import "tailwindcss"`, so
     * naming it directly is not a narrowing of what Tailwind sees — utilities
     * are still collected from the whole source tree by Tailwind's own content
     * scanning. It only stops the compiler being pointed at its own output.
     */
    rules: {
      "./src/app/globals.css": {
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
