import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { Options as MailOptions } from "nodemailer/lib/mailer";

import { trySaveToSentFolder, type SentCopyOptions } from "./sent-copy";
import type { MailAdapter, MailMessage, MailResult } from "./types";

export interface SmtpAdapterOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  password?: string | undefined;
  from: string;
  replyTo?: string | undefined;
  /**
   * Where to file a copy of each sent message. Absent means no copy — the
   * behaviour this adapter had before, and still the right one for a relay
   * with no mailbox behind it.
   */
  sentCopy?: SentCopyOptions | undefined;
}

/**
 * The bare address out of a configured `from`, which may carry a display name.
 *
 * Only the address is reused when a message supplies its own display name;
 * keeping the configured name as well would produce two of them.
 */
function addressOf(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1]?.trim() ?? from.trim();
}

/**
 * SMTP transport.
 *
 * SMTP rather than a provider-specific SDK because every mainstream service
 * speaks it, which keeps switching providers an environment change instead of
 * a code change — and lets development run against a local catcher such as
 * Mailpit, where the send is genuinely real but nothing leaves the machine.
 */
export class SmtpMailAdapter implements MailAdapter {
  readonly provider = "smtp";

  private transporter: Transporter | undefined;

  constructor(private readonly options: SmtpAdapterOptions) {}

  /**
   * The transporter is built on first use and reused.
   *
   * nodemailer pools connections per transporter, so constructing one per
   * message would open a fresh TCP and TLS handshake every time — slow, and
   * enough to trip the connection-rate limits providers apply.
   */
  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const { host, port, secure, user, password } = this.options;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      // Anonymous relay is legitimate for a local catcher and for an internal
      // relay that authorises by network, so credentials stay optional.
      ...(user && password ? { auth: { user, pass: password } } : {}),
    });

    return this.transporter;
  }

  async send(message: MailMessage): Promise<MailResult> {
    const options: MailOptions = {
      // Handed to nodemailer as parts rather than as a string, so it does the
      // RFC 5322 quoting of a name that contains a comma, a quote or
      // non-ASCII. The address is ours either way; see `fromName`.
      from: message.fromName
        ? { name: message.fromName, address: addressOf(this.options.from) }
        : this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ?? this.options.replyTo
        ? { replyTo: message.replyTo ?? this.options.replyTo }
        : {}),
      // `cid` makes nodemailer place the part inline and reference it from the
      // HTML, rather than hanging it off the message as a download.
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              contentType: attachment.contentType,
              ...(attachment.cid ? { cid: attachment.cid } : {}),
            })),
          }
        : {}),
    };

    // Composed here rather than inside `sendMail`, so the exact bytes that go
    // to the server are also the bytes filed in Sent. Composing twice would
    // mint a second Message-ID, and the copy would no longer be the message
    // the customer's reply threads against.
    const raw = await new MailComposer(options).compile().build();

    const info = await this.getTransporter().sendMail({
      raw,
      // Required with `raw`: the transport reads recipients from the envelope
      // rather than parsing headers back out of the message.
      envelope: { from: this.options.from, to: message.to },
    });

    if (this.options.sentCopy) {
      await trySaveToSentFolder(this.options.sentCopy, raw);
    }

    // The message's own id first, not nodemailer's. Handed a `raw` buffer it
    // does not read the id back out — it mints a fresh one for `info` that
    // appears nowhere in what was sent, so trusting it would fill
    // `providerReference` with an id that matches nothing in the provider's
    // logs and nothing in the mailbox.
    return { providerReference: messageIdOf(raw) ?? info.messageId };
  }

  /**
   * Checks the server accepts a connection and any credentials.
   *
   * Used by the smoke test, so a broken mail configuration is found during
   * deployment rather than by a customer not receiving a confirmation.
   */
  async verify(): Promise<void> {
    await this.getTransporter().verify();
  }
}

/**
 * Reads the Message-ID back out of a composed message.
 *
 * nodemailer derives `info.messageId` from the structured options it was
 * given; handed a `raw` buffer it has nothing to read, and the id is what
 * `providerReference` is for — tracing one message in a provider's console.
 */
function messageIdOf(raw: Buffer): string | undefined {
  // Headers only: the body may well contain the same characters, and a MIME
  // message always separates the two with a blank line.
  const headerEnd = raw.indexOf("\r\n\r\n");
  const headers = raw.subarray(0, headerEnd === -1 ? raw.length : headerEnd);

  return /^message-id:\s*(<[^>]+>)/im.exec(headers.toString("utf8"))?.[1];
}
