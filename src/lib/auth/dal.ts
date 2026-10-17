import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { AdminUserStatus } from "@/generated/prisma/enums";
import type { AdminRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import {
  ForbiddenError,
  getPermissionsForRole,
  type PermissionKey,
} from "@/lib/permissions";

import { readSessionToken, resolveSession } from "./session";

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
  const token = await readSessionToken();
  if (!token) return null;

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

  // A suspended or deactivated account is rejected even while holding a session
  // that has not yet expired.
  if (user.status !== AdminUserStatus.ACTIVE) return null;

  return { ...user, sessionId: session.sessionId };
});

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
    throw new ForbiddenError(permission);
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
    if (!granted.has(permission)) throw new ForbiddenError(permission);
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
