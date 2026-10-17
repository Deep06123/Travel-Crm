import "server-only";

import { cache } from "react";

import type { AdminRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";

import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  type PermissionKey,
} from "./catalog";

export * from "./catalog";

/**
 * Raised when an authenticated administrator lacks a required capability.
 * Route handlers map this to 403; pages map it to a "not permitted" view.
 */
export class ForbiddenError extends Error {
  readonly permission: PermissionKey;

  constructor(permission: PermissionKey) {
    super(`Missing required permission: ${permission}`);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

/**
 * Loads the permission keys granted to a role.
 *
 * `cache` deduplicates this within a single request, so a page that checks a
 * dozen permissions issues one query rather than a dozen.
 */
export const getPermissionsForRole = cache(
  async (role: AdminRole): Promise<ReadonlySet<PermissionKey>> => {
    const grants = await prisma.rolePermission.findMany({
      where: { role },
      select: { permission: { select: { key: true } } },
    });

    return new Set(grants.map((grant) => grant.permission.key as PermissionKey));
  },
);

/** True when `role` holds `permission`. */
export async function roleHasPermission(
  role: AdminRole,
  permission: PermissionKey,
): Promise<boolean> {
  const granted = await getPermissionsForRole(role);
  return granted.has(permission);
}

/** True when `role` holds every one of `permissions`. */
export async function roleHasAllPermissions(
  role: AdminRole,
  permissions: readonly PermissionKey[],
): Promise<boolean> {
  const granted = await getPermissionsForRole(role);
  return permissions.every((permission) => granted.has(permission));
}

/** True when `role` holds at least one of `permissions`. */
export async function roleHasAnyPermission(
  role: AdminRole,
  permissions: readonly PermissionKey[],
): Promise<boolean> {
  const granted = await getPermissionsForRole(role);
  return permissions.some((permission) => granted.has(permission));
}

/** Known permission keys, used to validate role-configuration input. */
export function isKnownPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_DEFINITIONS.some((definition) => definition.key === value);
}

export { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS };
