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

  // Every protected route requires a session cookie. There is no longer a
  // demo mode to exempt anyone: the access layer has a single way in, and this
  // guard mirrors it rather than keeping a second rule that could disagree.
  if (!hasSessionCookie && !isLoginRoute) {
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
