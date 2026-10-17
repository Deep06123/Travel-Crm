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

  if (hasSessionCookie && isLoginRoute) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
