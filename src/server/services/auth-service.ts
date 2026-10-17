import "server-only";

import { AdminUserStatus, LoginEventType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";
import {
  hashPassword,
  needsRehash,
  simulatePasswordVerification,
  verifyPassword,
} from "@/lib/auth/password";
import {
  createSession,
  revokeAllSessionsForUser,
  revokeSession,
  type IssuedSession,
  type SessionContext,
} from "@/lib/auth/session";

const log = loggerFor("auth-service");

/**
 * Sign-in, sign-out and account lockout.
 *
 * Every outcome below returns the same generic message to the caller. Telling
 * an attacker whether an address is registered, or whether the account is
 * locked, hands them a user-enumeration oracle; the detail goes to the
 * LoginEvent trail instead, where staff can see it and attackers cannot.
 */

const GENERIC_FAILURE_MESSAGE = "Invalid email or password.";

export type LoginResult =
  | { ok: true; session: IssuedSession; mustChangePassword: boolean }
  | { ok: false; message: string };

interface LoginInput {
  identifier: string;
  password: string;
  context?: SessionContext;
}

async function recordLoginEvent(
  type: LoginEventType,
  identifier: string,
  adminUserId: string | null,
  context: SessionContext,
  reason?: string,
): Promise<void> {
  try {
    await prisma.loginEvent.create({
      data: {
        type,
        identifier,
        adminUserId,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        reason: reason ?? null,
      },
    });
  } catch (error) {
    log.error({ err: error, type }, "Failed to record login event");
  }
}

/**
 * Authenticates an administrator and issues a session.
 *
 * Accepts either the email address or the operational username, since the
 * booking floor signs in with short handles.
 */
export async function login({
  identifier,
  password,
  context = {},
}: LoginInput): Promise<LoginResult> {
  const env = getEnv();
  const normalised = identifier.trim().toLowerCase();

  const user = await prisma.adminUser.findFirst({
    where: {
      OR: [{ email: normalised }, { username: normalised }],
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      status: true,
      failedLoginAttempts: true,
      lockedUntil: true,
      mustChangePassword: true,
    },
  });

  if (!user) {
    // Spend the same time a real bcrypt comparison would, so response latency
    // does not reveal which addresses exist.
    await simulatePasswordVerification();
    await recordLoginEvent(
      LoginEventType.FAILED_UNKNOWN_USER,
      normalised,
      null,
      context,
    );
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  if (user.status !== AdminUserStatus.ACTIVE) {
    await simulatePasswordVerification();
    await recordLoginEvent(
      LoginEventType.FAILED_PASSWORD,
      normalised,
      user.id,
      context,
      `Account status is ${user.status}`,
    );
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await simulatePasswordVerification();
    await recordLoginEvent(
      LoginEventType.LOCKED_OUT,
      normalised,
      user.id,
      context,
      `Locked until ${user.lockedUntil.toISOString()}`,
    );
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches) {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= env.LOGIN_MAX_ATTEMPTS;

    await prisma.adminUser.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + env.LOGIN_LOCKOUT_SECONDS * 1000)
          : null,
      },
    });

    await recordLoginEvent(
      shouldLock ? LoginEventType.LOCKED_OUT : LoginEventType.FAILED_PASSWORD,
      normalised,
      user.id,
      context,
      shouldLock ? `Locked after ${attempts} failed attempts` : undefined,
    );

    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }

  // Successful sign-in: clear the failure counter and upgrade the stored digest
  // if it predates the current bcrypt cost.
  const updates: { failedLoginAttempts: number; lockedUntil: null; lastLoginAt: Date; passwordHash?: string } = {
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
  };

  if (needsRehash(user.passwordHash)) {
    updates.passwordHash = await hashPassword(password);
  }

  await prisma.adminUser.update({ where: { id: user.id }, data: updates });

  const session = await createSession(user.id, context);
  await recordLoginEvent(LoginEventType.SUCCESS, normalised, user.id, context);

  return {
    ok: true,
    session,
    mustChangePassword: user.mustChangePassword,
  };
}

/** Revokes the supplied session and records the sign-out. */
export async function logout(
  token: string,
  adminUserId: string | null,
  identifier: string,
  context: SessionContext = {},
): Promise<void> {
  await revokeSession(token);
  await recordLoginEvent(
    LoginEventType.LOGOUT,
    identifier,
    adminUserId,
    context,
  );
}

/**
 * Changes a password and ends every other session for the account.
 *
 * A password change must not leave an attacker's existing session alive, so all
 * sessions are revoked; the caller signs in again afterwards.
 */
export async function changePassword(
  adminUserId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await prisma.adminUser.findUnique({
    where: { id: adminUserId },
    select: { id: true, email: true, passwordHash: true },
  });

  if (!user) return { ok: false, message: "Account not found." };

  const matches = await verifyPassword(currentPassword, user.passwordHash);
  if (!matches) {
    return { ok: false, message: "Current password is incorrect." };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.adminUser.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  const revoked = await revokeAllSessionsForUser(user.id);
  await recordLoginEvent(
    LoginEventType.SESSION_REVOKED,
    user.email,
    user.id,
    {},
    `Password changed; ${revoked} session(s) revoked`,
  );

  return { ok: true };
}
