import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The box that holds a sending account's SMTP password.
 *
 * Two properties matter here and nothing else does. A sealed secret must come
 * back exactly, or an operator's working credentials silently become a
 * provider rejection. And a secret sealed under a different `AUTH_SECRET` must
 * refuse to open rather than return rubbish that gets handed to an SMTP server
 * as a password — which is why this is GCM and not CBC.
 *
 * `getEnv` caches on first read, so each case re-imports the module under the
 * environment it needs.
 */

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function boxWith(authSecret: string) {
  vi.stubEnv("AUTH_SECRET", authSecret);
  vi.resetModules();
  return import("@/lib/crypto/secret-box");
}

describe("secret box", () => {
  it("returns exactly what was sealed", async () => {
    const { sealSecret, openSecret } = await boxWith(SECRET_A);

    // Characters an SMTP password plausibly contains and a naive encoding
    // would mangle: a non-ASCII letter, a quote, a dot and a space.
    const password = 'p@ss "wörd".1 ';

    expect(openSecret(sealSecret(password, "mail"), "mail")).toBe(password);
  });

  it("produces a different ciphertext each time", async () => {
    const { sealSecret } = await boxWith(SECRET_A);

    // A fresh IV per seal: two accounts sharing a password must not be visible
    // as identical columns to anyone reading a dump.
    expect(sealSecret("same", "mail")).not.toBe(sealSecret("same", "mail"));
  });

  it("refuses a secret sealed under a different AUTH_SECRET", async () => {
    const { sealSecret } = await boxWith(SECRET_A);
    const sealed = sealSecret("hunter2", "mail");

    const { openSecret, SecretUnsealError } = await boxWith(SECRET_B);

    expect(() => openSecret(sealed, "mail")).toThrow(SecretUnsealError);
  });

  it("keeps purposes independent", async () => {
    const { sealSecret, openSecret, SecretUnsealError } =
      await boxWith(SECRET_A);

    const sealed = sealSecret("hunter2", "mail");

    expect(() => openSecret(sealed, "something-else")).toThrow(
      SecretUnsealError,
    );
  });

  it("rejects a tampered payload rather than decrypting it", async () => {
    const { sealSecret, openSecret, SecretUnsealError } =
      await boxWith(SECRET_A);

    const sealed = sealSecret("hunter2", "mail");
    const parts = sealed.split(".");
    // Flip a character of the ciphertext. Without the GCM tag this would
    // decrypt to a wrong password instead of failing.
    const last = parts[3]!;
    parts[3] = (last[0] === "A" ? "B" : "A") + last.slice(1);

    expect(() => openSecret(parts.join("."), "mail")).toThrow(SecretUnsealError);
  });

  it("rejects a value that is not a sealed secret at all", async () => {
    const { openSecret, SecretUnsealError } = await boxWith(SECRET_A);

    // A hand-edited column, or a plaintext password someone pasted in.
    expect(() => openSecret("hunter2", "mail")).toThrow(SecretUnsealError);
  });
});
