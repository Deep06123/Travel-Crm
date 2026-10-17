import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";

/**
 * Database-backed sessions.
 *
 * A stateless token could not be revoked before its expiry, which the brief
 * requires: suspending an administrator has to end their access immediately.
 * The cookie therefore carries an opaque random token, and authority rests with
 * the AdminSession row, which can be revoked at any moment.
 *
 * Only the SHA-256 of the token is stored. A database leak yields digests, not
 * usable sessions. SHA-256 rather than bcrypt is deliberate here: the token is
 * 256 bits of CSPRNG output, so it is not guessable and needs no key
 * stretching, and session lookup happens on every request.
 */

export const SESSION_COOKIE_NAME = "crm_session";

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/**
 * Creates a session row and returns the raw token.
 *
 * The caller is responsible for placing the token in the cookie; it is never
 * recoverable afterwards.
 */
export async function createSession(
  adminUserId: string,
  context: SessionContext = {},
): Promise<IssuedSession> {
  const env = getEnv();
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_MAX_AGE_SECONDS * 1000);

  await prisma.adminSession.create({
    data: {
      tokenHash: hashToken(token),
      adminUserId,
      expiresAt,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    },
  });

  return { token, expiresAt };
}

/** Writes the session cookie. httpOnly keeps it out of reach of any script. */
export async function setSessionCookie(session: IssuedSession): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function readSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/** Marks a single session revoked. Takes effect on the next request. */
export async function revokeSession(token: string): Promise<void> {
  await prisma.adminSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes every live session for an administrator.
 *
 * Used when an account is suspended, deactivated, or has its password changed.
 */
export async function revokeAllSessionsForUser(
  adminUserId: string,
): Promise<number> {
  const result = await prisma.adminSession.updateMany({
    where: { adminUserId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return result.count;
}

export interface ResolvedSession {
  sessionId: string;
  adminUserId: string;
  expiresAt: Date;
}

/**
 * Resolves a raw token to a live session, or null.
 *
 * Returns null for tokens that are unknown, revoked or expired. Expiry is
 * re-checked in application code rather than trusted to the cookie, since the
 * client controls the cookie's own expiry.
 */
export async function resolveSession(
  token: string,
): Promise<ResolvedSession | null> {
  const tokenHash = hashToken(token);

  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      adminUserId: true,
      expiresAt: true,
      revokedAt: true,
      tokenHash: true,
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  // Defence in depth against a future lookup path that is not a direct unique
  // match: confirm the digest really is the one we computed.
  const stored = Buffer.from(session.tokenHash, "hex");
  const computed = Buffer.from(tokenHash, "hex");
  if (stored.length !== computed.length || !timingSafeEqual(stored, computed)) {
    return null;
  }

  return {
    sessionId: session.id,
    adminUserId: session.adminUserId,
    expiresAt: session.expiresAt,
  };
}

/** Records session activity. Best-effort; never blocks the request. */
export async function touchSession(sessionId: string): Promise<void> {
  await prisma.adminSession.update({
    where: { id: sessionId },
    data: { lastActiveAt: new Date() },
  });
}

/** Deletes sessions that expired more than `olderThanDays` ago. */
export async function purgeExpiredSessions(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const result = await prisma.adminSession.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });

  return result.count;
}
