import "server-only";

import bcrypt from "bcryptjs";

/**
 * Password hashing.
 *
 * Cost 12 is the current balance between resistance to offline cracking and
 * login latency on commodity hardware. Raising it later is safe: `verify`
 * reads the cost from the stored digest, so old hashes keep working and
 * `needsRehash` flags them for upgrade on the user's next successful sign-in.
 */
const BCRYPT_COST = 12;

/** Minimum length accepted for a new password. */
export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Checks a password against a stored digest.
 *
 * bcrypt's own comparison is constant-time with respect to the digest, so this
 * does not leak how much of the password matched.
 */
export async function verifyPassword(
  plaintext: string,
  digest: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, digest);
  } catch {
    // A malformed digest in the database must read as "wrong password" rather
    // than crash the login route.
    return false;
  }
}

/** True when a stored digest was produced with a weaker cost than current. */
export function needsRehash(digest: string): boolean {
  try {
    return bcrypt.getRounds(digest) < BCRYPT_COST;
  } catch {
    return true;
  }
}

/**
 * Burns roughly the same time as a real bcrypt comparison.
 *
 * Called when the submitted email matches no account, so that response timing
 * does not reveal which addresses are registered.
 */
export async function simulatePasswordVerification(): Promise<void> {
  await bcrypt.compare(
    "timing-equalisation",
    "$2b$12$Ug8vL0M4Q5nR1aT7xYwZ2eJ9kB3cD6fH8iL0mN2oP4qR6sT8uV0wW",
  );
}
