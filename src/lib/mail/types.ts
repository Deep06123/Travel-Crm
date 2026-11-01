import "server-only";

/**
 * Outbound email.
 *
 * `text` is required and `html` optional, never the other way round. A
 * text-only client, a screen reader and a spam filter all read the plain part,
 * and an HTML-only message scores badly with every one of them.
 */
/**
 * A file carried inside the message.
 *
 * Present for images embedded in an itinerary, which cannot be linked: they
 * are served from an administrator-only route, so a customer's mail client
 * could never fetch one. Referenced from the HTML part as `src="cid:<cid>"`.
 */
export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Set for an image referenced by the body; absent for a plain attachment. */
  cid?: string | undefined;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | undefined;
  attachments?: readonly MailAttachment[] | undefined;
}

export interface MailResult {
  /** Provider message id, kept so a delivery can be traced in their console. */
  providerReference?: string | undefined;
}

export interface MailAdapter {
  /** Name recorded on the Notification row, e.g. "smtp". */
  readonly provider: string;
  send(message: MailMessage): Promise<MailResult>;
}

/**
 * Thrown when no transport is configured.
 *
 * Deliberately distinct from a send failure: nothing was attempted, so the
 * notification is recorded as SUPPRESSED rather than FAILED. Treating the two
 * alike would bury a missing configuration among genuine provider errors.
 */
export class MailNotConfiguredError extends Error {
  constructor() {
    super(
      'No mail transport is configured. Set MAIL_DRIVER="smtp" and the SMTP_* variables to send customer email.',
    );
    this.name = "MailNotConfiguredError";
  }
}
