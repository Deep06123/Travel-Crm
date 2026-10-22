/**
 * Resets an administrator's password and revokes their live sessions.
 *
 * This exists because a forgotten password is unrecoverable by design: only a
 * bcrypt digest is stored, there is no read path that returns a plaintext
 * password, and no role — including SUPER_ADMIN — can reveal one. Regaining
 * access therefore means setting a new password, never looking the old one up.
 *
 * Operator access to the database is itself the authorisation here, which is
 * why this is a script run on the server rather than a page in the UI.
 *
 * Usage:
 *   npm run admin:reset-password -- <email-or-username> [password]
 *
 * Omit the password to have a strong one generated and printed once. The
 * account is always flagged to change it at next sign-in, so a password typed
 * on a command line (and left in shell history) cannot remain in use.
 */
import { randomBytes } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../src/generated/prisma/client.js";

// Mirrors src/lib/auth/password.ts, which cannot be imported here: it is
// marked `server-only`, a guard meant to keep hashing out of client bundles.
// If the cost factor changes there, change it here too.
const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 12;

const identifier = process.argv[2];
const supplied = process.argv[3];

if (!identifier) {
  console.error("usage: npm run admin:reset-password -- <email-or-username> [password]");
  process.exit(1);
}

if (supplied !== undefined && supplied.length < MIN_PASSWORD_LENGTH) {
  console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Run via npm so .env is loaded.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const normalised = identifier.trim().toLowerCase();
const user = await prisma.adminUser.findFirst({
  where: { OR: [{ email: normalised }, { username: normalised }] },
  select: { id: true, email: true, username: true, name: true, status: true },
});

if (!user) {
  console.error(`No administrator matches "${identifier}".`);
  await prisma.$disconnect();
  process.exit(1);
}

// base64url keeps the password copy-pasteable: no characters a shell, a URL or
// a double-click selection would mangle.
const password = supplied ?? randomBytes(18).toString("base64url");
const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

// One transaction, so an account can never end up with a new password while
// sessions opened under the old one are still valid.
const { count } = await prisma.$transaction(async (tx) => {
  await tx.adminUser.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  // Sessions are database-backed precisely so this takes effect immediately
  // rather than whenever a stateless token would have expired.
  return tx.adminSession.updateMany({
    where: { adminUserId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
});

await prisma.$disconnect();

console.log(`\nPassword reset for ${user.name} <${user.email}> (${user.username})`);
console.log(`Sessions revoked: ${count}`);
if (supplied === undefined) {
  console.log(`\n  Password: ${password}\n`);
  console.log("Shown once. It is not recoverable — rerun this script if it is lost.");
}
console.log("The account must change this password at next sign-in.");
