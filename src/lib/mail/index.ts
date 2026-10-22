import "server-only";

import { getEnv } from "@/lib/env";

import { SmtpMailAdapter } from "./smtp-adapter";
import { type MailAdapter, MailNotConfiguredError } from "./types";

export * from "./types";
export { SmtpMailAdapter } from "./smtp-adapter";

/**
 * Mail transport selection, mirroring `getStorage()`.
 *
 * Returns `null` rather than throwing when `MAIL_DRIVER` is "none": callers
 * record a SUPPRESSED notification and carry on. An unconfigured mailer must
 * never be able to fail a booking confirmation.
 */

let cached: MailAdapter | null | undefined;

export function getMailer(): MailAdapter | null {
  if (cached !== undefined) return cached;

  const env = getEnv();

  switch (env.MAIL_DRIVER) {
    case "none":
      cached = null;
      return cached;

    case "smtp":
      // Non-null assertions are safe: the env schema refuses to parse an
      // `smtp` driver without a host and a from address.
      cached = new SmtpMailAdapter({
        host: env.SMTP_HOST!,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        from: env.MAIL_FROM!,
        replyTo: env.MAIL_REPLY_TO,
      });
      return cached;

    default: {
      // Exhaustiveness guard: a new driver in the enum that is not handled
      // here becomes a compile error rather than a runtime surprise.
      const unreachable: never = env.MAIL_DRIVER;
      throw new Error(`Unsupported mail driver: ${String(unreachable)}`);
    }
  }
}

/** For callers that genuinely cannot proceed without a transport. */
export function requireMailer(): MailAdapter {
  const mailer = getMailer();
  if (!mailer) throw new MailNotConfiguredError();
  return mailer;
}

/** Test seam; the adapter is otherwise cached for the process lifetime. */
export function resetMailerCache(): void {
  cached = undefined;
}
