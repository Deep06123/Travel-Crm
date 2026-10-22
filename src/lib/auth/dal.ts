import "server-only";

import { cache } from "react";
import { forbidden, redirect } from "next/navigation";

import { AdminUserStatus } from "@/generated/prisma/enums";
import type { AdminRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { isDatabaseUnavailable } from "@/lib/db/errors";
import { getEnv } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";
import { getPermissionsForRole, type PermissionKey } from "@/lib/permissions";

import { DEMO_ADMIN_ID } from "./demo-identity";
import { readSessionToken, resolveSession } from "./session";

const log = loggerFor("auth-dal");

/**
 * Data Access Layer for authentication and authorization.
 *
 * Every protected read or write goes through one of these functions. Checks
 * live here — next to the data — rather than in routing or UI code, so a new
 * page or handler cannot accidentally ship without one. Hiding a control in the
 * interface is presentation, never enforcement.
 */

export interface CurrentUser {
  id: string;
  email: string;
  username: string | null;
  name: string;
  role: AdminRole;
  status: AdminUserStatus;
  mustChangePassword: boolean;
  sessionId: string;
}

/**
 * Resolves the signed-in administrator, or null.
 *
 * `cache` scopes the result to a single request, so a page that calls this from
 * a layout, the page body and three components still performs one lookup.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Demo deployments resolve an administrator without a stored session.
  //
  // Sessions live in the database, which is the right design when one database
  // serves every request. A demo running the embedded database has no such
  // thing: each serverless instance keeps its own copy, so a session written
  // while signing in is absent from the instance that serves the next request,
  // and the visitor is signed in and out at random depending on where they
  // land. Resolving the fixed demo administrator instead is stable everywhere,
  // because every instance creates it identically at boot.
  if (getEnv().DEMO_MODE) {
    const demo = await resolveDemoUser();
    if (demo) return demo;
    // Falls through when the account is missing, so a deployment with
    // DEMO_MODE on but a hosted database still signs in normally.
  }

  const token = await readSessionToken();
  if (!token) return null;

  try {
    const session = await resolveSession(token);
    if (!session) return null;

    const user = await prisma.adminUser.findUnique({
      where: { id: session.adminUserId },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        status: true,
        mustChangePassword: true,
      },
    });

    if (!user) return null;

    // A suspended or deactivated account is rejected even while holding a
    // session that has not yet expired.
    if (user.status !== AdminUserStatus.ACTIVE) return null;

    return { ...user, sessionId: session.sessionId };
  } catch (error) {
    // An unreachable database must not render a Prisma stack trace into the
    // browser. Failing closed — treating the caller as signed out — sends them
    // to the login page, where the action reports the outage in plain words.
    // Only infrastructure failures are swallowed; a genuine bug still throws.
    if (isDatabaseUnavailable(error)) {
      log.error({ err: error }, "Session lookup failed: database unreachable");
      return null;
    }

    throw error;
  }
});

/**
 * Looks up the fixed demo administrator.
 *
 * Returns null rather than throwing when the database is unreachable or the
 * account is absent, so a misconfigured demo degrades to an ordinary sign-in
 * instead of failing the request outright.
 */
async function resolveDemoUser(): Promise<CurrentUser | null> {
  try {
    const user = await prisma.adminUser.findUnique({
      where: { id: DEMO_ADMIN_ID },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        status: true,
        mustChangePassword: true,
      },
    });

    if (!user || user.status !== AdminUserStatus.ACTIVE) return null;

    // No session row exists for this user, by design. `sessionId` is only used
    // for revocation, which does not apply to an account nobody signs into.
    return { ...user, sessionId: "demo" };
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      log.error({ err: error }, "Demo user lookup failed: database unreachable");
      return null;
    }

    throw error;
  }
}

/** Returns the current administrator, or redirects to the login page. */
export async function requireAuth(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  return user;
}

/**
 * Returns the current administrator, or throws.
 *
 * For Route Handlers and Server Actions, which should answer 401 rather than
 * issue a redirect.
 */
export async function requireAuthOrThrow(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedError";
  }
}

/**
 * Asserts the current administrator holds `permission`.
 *
 * Throws UnauthenticatedError when signed out and ForbiddenError when signed in
 * without the capability — the two cases need different responses.
 */
export async function requirePermission(
  permission: PermissionKey,
): Promise<CurrentUser> {
  const user = await requireAuthOrThrow();
  const granted = await getPermissionsForRole(user.role);

  if (!granted.has(permission)) {
    // `forbidden()` renders forbidden.tsx with a 403. Throwing instead
    // produced a 500, which is wrong — a denial is not a server fault, and it
    // buried real faults in monitoring noise.
    forbidden();
  }

  return user;
}

/** Asserts the current administrator holds every listed permission. */
export async function requireAllPermissions(
  permissions: readonly PermissionKey[],
): Promise<CurrentUser> {
  const user = await requireAuthOrThrow();
  const granted = await getPermissionsForRole(user.role);

  for (const permission of permissions) {
    if (!granted.has(permission)) forbidden();
  }

  return user;
}

/**
 * Non-throwing check, for deciding whether to render a control.
 *
 * This is a presentation helper. The action behind the control must still call
 * `requirePermission` on the server.
 */
export async function currentUserCan(
  permission: PermissionKey,
): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;

  const granted = await getPermissionsForRole(user.role);
  return granted.has(permission);
}

/** All permissions held by the current administrator. Empty when signed out. */
export async function getCurrentUserPermissions(): Promise<
  ReadonlySet<PermissionKey>
> {
  const user = await getCurrentUser();
  if (!user) return new Set();
  return getPermissionsForRole(user.role);
}
