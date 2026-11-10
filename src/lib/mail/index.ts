import "server-only";

import { getEnv } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";

import { deriveImapHost, type SentCopyOptions } from "./sent-copy";
import { SmtpMailAdapter } from "./smtp-adapter";
import { type MailAdapter, MailNotConfiguredError } from "./types";

const log = loggerFor("mail");

export * from "./types";
export { SmtpMailAdapter, type SmtpAdapterOptions } from "./smtp-adapter";
export {
  appendToSentFolder,
  deriveImapHost,
  resetSentFolderCache,
  type SentCopyOptions,
} from "./sent-copy";

/**
 * Mail transport selection, mirroring `getStorage()`.
 *
 * Returns `null` rather than throwing when `MAIL_DRIVER` is "none": callers
 * record a SUPPRESSED notification and carry on. An unconfigured mailer must
 * never be able to fail a booking confirmation.
 */

let cached: MailAdapter | null | undefined;

/**
 * Sent-folder configuration from the environment, or undefined for no copy.
 *
 * Returns undefined rather than throwing on a half-configuration: the SMTP
 * credentials are reused for IMAP, so a relay that authorises by network has
 * nothing to sign in with, and the message must still go out.
 */
function envSentCopy(env: ReturnType<typeof getEnv>): SentCopyOptions | undefined {
  if (!env.MAIL_SAVE_TO_SENT) return undefined;

  const host = env.IMAP_HOST ?? deriveImapHost(env.SMTP_HOST!);

  if (!host || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    log.warn(
      { smtpHost: env.SMTP_HOST, imapHost: env.IMAP_HOST },
      "MAIL_SAVE_TO_SENT is on but there is no IMAP host or no credentials to use; no copy will be filed",
    );
    return undefined;
  }

  return {
    host,
    port: env.IMAP_PORT,
    secure: env.IMAP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    ...(env.MAIL_SENT_FOLDER ? { mailbox: env.MAIL_SENT_FOLDER } : {}),
  };
}

export function getMailer(): MailAdapter | null {
  if (cached !== undefined) return cached;

  const env = getEnv();

  switch (env.MAIL_DRIVER) {
    case "none":
      cached = null;
      return cached;

    case "smtp": {
      // Non-null assertions are safe: the env schema refuses to parse an
      // `smtp` driver without a host and a from address.
      const sentCopy = envSentCopy(env);

      cached = new SmtpMailAdapter({
        host: env.SMTP_HOST!,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        from: env.MAIL_FROM!,
        replyTo: env.MAIL_REPLY_TO,
        ...(sentCopy ? { sentCopy } : {}),
      });
      return cached;
    }

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
