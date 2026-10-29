import { describe, expect, it } from "vitest";

import { AdminRole } from "@/generated/prisma/enums";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  PERMISSIONS,
} from "@/lib/permissions";

/**
 * The permission catalogue.
 *
 * `booking.delete` is the one worth guarding with a test: it is the only key
 * that destroys a record outright, and the damage of it quietly reaching an
 * ordinary operations role is not the sort that shows up in review.
 */

describe("permission catalogue", () => {
  it("defines every key it exports", () => {
    const defined = new Set(
      PERMISSION_DEFINITIONS.map((definition) => definition.key),
    );

    for (const key of Object.values(PERMISSIONS)) {
      expect(defined, `missing definition for ${key}`).toContain(key);
    }
  });

  it("grants booking.delete to super admins only", () => {
    for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const granted = keys.includes(PERMISSIONS.BOOKING_DELETE);

      expect(granted, `${role} should ${
        role === AdminRole.SUPER_ADMIN ? "" : "not "
      }hold booking.delete`).toBe(role === AdminRole.SUPER_ADMIN);
    }
  });

  it("keeps deleting a booking separate from cancelling one", () => {
    // Cancellation keeps the record; deletion erases it. A role trusted with
    // the first is not thereby trusted with the second.
    expect(
      DEFAULT_ROLE_PERMISSIONS[AdminRole.OPERATIONS],
    ).toContain(PERMISSIONS.BOOKING_CANCEL);
    expect(
      DEFAULT_ROLE_PERMISSIONS[AdminRole.OPERATIONS],
    ).not.toContain(PERMISSIONS.BOOKING_DELETE);
  });
});
