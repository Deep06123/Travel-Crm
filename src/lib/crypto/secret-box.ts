import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { getEnv } from "@/lib/env";

/**
 * Authenticated encryption for the few secrets that have to live in the
 * database rather than in the environment.
 *
 * There is exactly one of those today: the SMTP password on a `MailAccount`.
 * Which mailbox a customer email comes from is a business decision an operator
 * makes in the settings screen, so the credential cannot be an environment
 * variable — and a credential in a column has to be unreadable to anyone who
 * walks off with a database dump.
 *
 * GCM rather than CBC so the ciphertext is tamper-evident: a flipped byte
 * fails the tag check and throws, instead of decrypting to rubbish that gets
 * handed to an SMTP server as a password.
 */

/** Versioned so a future algorithm change can be told apart on sight. */
const VERSION = "v1";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The key is derived from `AUTH_SECRET`, never used directly.
 *
 * HKDF with a per-purpose `info` string means this key and any future one are
 * independent: compromising the mail key would not yield the key for anything
 * else derived from the same secret. The consequence worth writing down is
 * that **rotating `AUTH_SECRET` makes every stored password undecryptable** —
 * they have to be re-entered. That is the correct trade for a deployment where
 * the alternative is a plaintext credential in a table.
 */
function keyFor(purpose: string): Buffer {
  const secret = getEnv().AUTH_SECRET;

  // No salt: `AUTH_SECRET` is already high-entropy random material rather
  // than a password, and a stored salt would have to live beside the
  // ciphertext without adding anything a dump-reader does not have.
  return Buffer.from(
    hkdfSync("sha256", secret, Buffer.alloc(0), purpose, KEY_BYTES),
  );
}

/**
 * Encrypts a secret for storage.
 *
 * The result is `v1.<iv>.<tag>.<ciphertext>`, base64url so it survives a text
 * column, a JSON payload and a copy-paste out of a database client without
 * being mangled.
 */
export function sealSecret(plaintext: string, purpose: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFor(purpose), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Thrown when a stored secret cannot be read back.
 *
 * Distinct from a generic error because the overwhelmingly likely cause is a
 * rotated `AUTH_SECRET`, and the caller can say so rather than reporting an
 * opaque cipher failure to an administrator who would have no idea what to do
 * about it.
 */
export class SecretUnsealError extends Error {
  constructor() {
    super(
      "A stored secret could not be decrypted. This normally means AUTH_SECRET has changed since it was saved; the value must be entered again.",
    );
    this.name = "SecretUnsealError";
  }
}

/** Reverses `sealSecret`. Throws `SecretUnsealError` on any mismatch. */
export function openSecret(sealed: string, purpose: string): string {
  const [version, iv, tag, payload] = sealed.split(".");

  if (version !== VERSION || !iv || !tag || !payload) {
    throw new SecretUnsealError();
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      keyFor(purpose),
      Buffer.from(iv, "base64url"),
    );

    const authTag = Buffer.from(tag, "base64url");
    if (authTag.length !== TAG_BYTES) throw new SecretUnsealError();
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(Buffer.from(payload, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // `final()` throws when the tag does not verify, which is both "someone
    // edited the column" and "the key is no longer the one that sealed this".
    // Neither is recoverable here, and the distinction is not one the caller
    // can act on differently.
    throw new SecretUnsealError();
  }
}
