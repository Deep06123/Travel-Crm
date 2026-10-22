import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

/**
 * Optimistic routing guard.
 *
 * This runs on every matched request, including prefetches, so it only reads
 * the cookie's presence — no database lookup, no permission resolution. It is a
 * redirect convenience, NOT a security boundary: a forged cookie gets past it
 * and is then rejected by the Data Access Layer, where the real check lives.
 *
 * Renamed from `middleware` in Next.js 16; the runtime is always Node.js.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  const isLoginRoute = pathname === "/admin/login";

  // A demo deployment has no sign-in to send anyone to. The access layer
  // resolves the demo administrator without a session, so a missing cookie is
  // the normal case rather than a signed-out visitor — and bouncing them to a
  // login page they are not expected to use would make the site unreachable.
  //
  // Matched against "false" rather than "true" so it follows the same
  // default-on behaviour as the environment schema, which this file cannot
  // import: `proxy` runs before the application's module graph is available.
  const demoMode = process.env["DEMO_MODE"] !== "false";

  if (!demoMode && !hasSessionCookie && !isLoginRoute) {
    const loginUrl = new URL("/admin/login", request.url);

    // Preserve where the user was heading so sign-in can return them there.
    // Only a same-site path is carried over, never an absolute URL, so this
    // cannot be turned into an open redirect.
    if (pathname !== "/admin") {
      loginUrl.searchParams.set("next", `${pathname}${search}`);
    }

    return NextResponse.redirect(loginUrl);
  }

  // Deliberately NOT redirecting away from the login page when a cookie is
  // present. Only the database knows whether a session is still valid, and
  // this layer cannot ask it. Bouncing on cookie presence alone created an
  // infinite loop for any stale cookie — expired, revoked, or forged:
  //
  //   /admin       → cookie present, allowed through
  //   layout       → session invalid, redirects to /admin/login
  //   /admin/login → cookie present, redirected back to /admin
  //
  // which left the user at ERR_TOO_MANY_REDIRECTS and locked out until they
  // cleared cookies by hand. The login page performs the real check itself and
  // redirects an genuinely signed-in administrator to the dashboard.
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
