import "server-only";

import { randomBytes } from "node:crypto";

import { AdminRole, AdminUserStatus } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";

const log = loggerFor("demo-service");

/** Fixed identity, so repeated demo entries reuse one account and one history. */
const DEMO_EMAIL = "demo@travel-crm.invalid";

/**
 * Finds or creates the demo administrator.
 *
 * `.invalid` is reserved by RFC 2606 and can never be registered, so this
 * address cannot collide with a real person's and cannot receive mail — a demo
 * account that silently shared an inbox with a real one would be worse than no
 * demo at all.
 *
 * The password is random and immediately discarded. Nothing signs in as this
 * account by password; the only route is the demo action, which the
 * environment flag gates. Storing an unknown digest rather than a blank or
 * well-known one means that if DEMO_MODE is later turned off, the account
 * cannot be used to get back in.
 *
 * `mustChangePassword` stays false: the demo must land on the dashboard, not
 * on a forced password change for a password nobody has.
 */
export async function provisionDemoAdmin(): Promise<{ id: string }> {
  if (!getEnv().DEMO_MODE) {
    // Defence in depth. The caller checks too, but this service must not be
    // callable into existence from anywhere else while the flag is off.
    throw new Error("Refusing to provision a demo administrator: DEMO_MODE is off.");
  }

  const existing = await prisma.adminUser.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true, status: true },
  });

  if (existing) {
    // A suspended demo account would fail the Data Access Layer's status check
    // on the very next request and bounce the visitor back to the login page.
    if (existing.status !== AdminUserStatus.ACTIVE) {
      await prisma.adminUser.update({
        where: { id: existing.id },
        data: { status: AdminUserStatus.ACTIVE },
      });
    }

    return { id: existing.id };
  }

  const created = await prisma.adminUser.create({
    data: {
      email: DEMO_EMAIL,
      username: "demo",
      name: "Demo Administrator",
      passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
      role: AdminRole.SUPER_ADMIN,
      status: AdminUserStatus.ACTIVE,
      mustChangePassword: false,
    },
    select: { id: true },
  });

  log.warn(
    { adminUserId: created.id },
    "Demo administrator provisioned — this deployment is open without a sign-in",
  );

  return created;
}
