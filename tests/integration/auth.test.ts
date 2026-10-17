import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminRole, AdminUserStatus, LoginEventType } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import {
  createSession,
  resolveSession,
  revokeAllSessionsForUser,
  revokeSession,
} from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { login } from "@/server/services/auth-service";

/**
 * Authentication against the real database.
 *
 * These run on the development database and clean up after themselves. The
 * point is to exercise what a mock cannot: unique constraints, the lockout
 * counter actually persisting, and a revoked session really failing to resolve.
 */

const PASSWORD = "correct-horse-battery-staple";
const TEST_EMAIL = `auth-test-${Date.now()}@example.invalid`;

let userId: string;

beforeAll(async () => {
  const user = await prisma.adminUser.create({
    data: {
      email: TEST_EMAIL,
      name: "Auth Test User",
      passwordHash: await hashPassword(PASSWORD),
      role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  });

  userId = user.id;
});

afterAll(async () => {
  // Sessions and login events cascade or null out; remove the user last.
  await prisma.loginEvent.deleteMany({ where: { adminUserId: userId } });
  await prisma.adminSession.deleteMany({ where: { adminUserId: userId } });
  await prisma.adminUser.deleteMany({ where: { id: userId } });
  await prisma.loginEvent.deleteMany({ where: { identifier: TEST_EMAIL } });
  await prisma.$disconnect();
});

async function resetLockout(): Promise<void> {
  await prisma.adminUser.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}

describe("login", () => {
  it("accepts the correct password and issues a resolvable session", async () => {
    await resetLockout();

    const result = await login({ identifier: TEST_EMAIL, password: PASSWORD });
    expect(result.ok).toBe(true);

    if (!result.ok) return;

    const resolved = await resolveSession(result.session.token);
    expect(resolved?.adminUserId).toBe(userId);
  });

  it("rejects a wrong password", async () => {
    await resetLockout();

    const result = await login({ identifier: TEST_EMAIL, password: "wrong" });
    expect(result.ok).toBe(false);
  });

  it("gives the same message for a wrong password and an unknown account", async () => {
    await resetLockout();

    const wrongPassword = await login({
      identifier: TEST_EMAIL,
      password: "wrong",
    });
    const unknownUser = await login({
      identifier: "nobody@example.invalid",
      password: "wrong",
    });

    expect(wrongPassword.ok).toBe(false);
    expect(unknownUser.ok).toBe(false);

    // Differing messages would let an attacker enumerate valid addresses.
    if (!wrongPassword.ok && !unknownUser.ok) {
      expect(wrongPassword.message).toBe(unknownUser.message);
    }
  });

  it("records an event for an attempt against an unknown account", async () => {
    const identifier = `ghost-${Date.now()}@example.invalid`;
    await login({ identifier, password: "whatever" });

    const event = await prisma.loginEvent.findFirst({
      where: { identifier, type: LoginEventType.FAILED_UNKNOWN_USER },
    });

    expect(event).not.toBeNull();
    expect(event?.adminUserId).toBeNull();

    await prisma.loginEvent.deleteMany({ where: { identifier } });
  });

  it("locks the account after the configured number of failures", async () => {
    await resetLockout();

    const maxAttempts = Number(process.env["LOGIN_MAX_ATTEMPTS"] ?? 5);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await login({ identifier: TEST_EMAIL, password: "wrong" });
    }

    const locked = await prisma.adminUser.findUniqueOrThrow({
      where: { id: userId },
      select: { failedLoginAttempts: true, lockedUntil: true },
    });

    expect(locked.failedLoginAttempts).toBeGreaterThanOrEqual(maxAttempts);
    expect(locked.lockedUntil).not.toBeNull();

    // The correct password must still be refused while the lockout holds.
    const result = await login({ identifier: TEST_EMAIL, password: PASSWORD });
    expect(result.ok).toBe(false);

    await resetLockout();
  });

  it("clears the failure counter on a successful sign-in", async () => {
    await resetLockout();

    await login({ identifier: TEST_EMAIL, password: "wrong" });
    await login({ identifier: TEST_EMAIL, password: PASSWORD });

    const user = await prisma.adminUser.findUniqueOrThrow({
      where: { id: userId },
      select: { failedLoginAttempts: true, lastLoginAt: true },
    });

    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lastLoginAt).not.toBeNull();
  });

  it("refuses a suspended account holding the right password", async () => {
    await resetLockout();
    await prisma.adminUser.update({
      where: { id: userId },
      data: { status: AdminUserStatus.SUSPENDED },
    });

    const result = await login({ identifier: TEST_EMAIL, password: PASSWORD });
    expect(result.ok).toBe(false);

    await prisma.adminUser.update({
      where: { id: userId },
      data: { status: AdminUserStatus.ACTIVE },
    });
  });
});

describe("sessions", () => {
  it("stops resolving once revoked", async () => {
    const session = await createSession(userId);
    expect(await resolveSession(session.token)).not.toBeNull();

    await revokeSession(session.token);
    expect(await resolveSession(session.token)).toBeNull();
  });

  it("revokes every session for a user at once", async () => {
    const first = await createSession(userId);
    const second = await createSession(userId);

    const count = await revokeAllSessionsForUser(userId);
    expect(count).toBeGreaterThanOrEqual(2);

    expect(await resolveSession(first.token)).toBeNull();
    expect(await resolveSession(second.token)).toBeNull();
  });

  it("does not resolve an expired session", async () => {
    const session = await createSession(userId);
    const resolved = await resolveSession(session.token);

    await prisma.adminSession.update({
      where: { id: resolved!.sessionId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    expect(await resolveSession(session.token)).toBeNull();
  });

  it("does not resolve a token that was never issued", async () => {
    expect(await resolveSession("not-a-real-token")).toBeNull();
  });

  it("stores a digest rather than the token itself", async () => {
    const session = await createSession(userId);

    const row = await prisma.adminSession.findFirst({
      where: { adminUserId: userId },
      orderBy: { createdAt: "desc" },
      select: { tokenHash: true },
    });

    expect(row?.tokenHash).not.toBe(session.token);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
