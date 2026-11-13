import "server-only";

import { after } from "next/server";
import nodemailer, { type Transporter } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { Options as MailOptions } from "nodemailer/lib/mailer";

import { loggerFor } from "@/lib/logging/logger";

import { trySaveToSentFolder, type SentCopyOptions } from "./sent-copy";
import type { MailAdapter, MailMessage, MailResult } from "./types";

const log = loggerFor("smtp");

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

/** Sent-folder copies still in flight, so a test can wait for them. */
const pendingCopies = new Set<Promise<unknown>>();

/**
 * Files the Sent copy without the sender waiting for it.
 *
 * Saving to Sent is a second IMAP conversation — connect, log in, and upload
 * the whole message a second time — and the message has already been accepted
 * by the SMTP server before it starts. Awaiting it meant an operator sending an
 * authorization watched a progress spinner through two uploads of the same
 * megabytes, the second of which changes nothing for the customer.
 *
 * `after()` for the same reason the admin notices use it: a bare floating
 * promise races the response and can be abandoned when a platform freezes the
 * process between invocations. The fallback covers scripts and tests, which
 * run outside any request scope.
 */
function fileSentCopy(options: SentCopyOptions, raw: Buffer): void {
  const run = () => {
    const promise = trySaveToSentFolder(options, raw).finally(() => {
      pendingCopies.delete(promise);
    });

    pendingCopies.add(promise);
    return promise;
  };

  try {
    after(run);
  } catch {
    void run();
  }
}

/** Waits for every Sent-folder copy still in flight. For tests. */
export async function flushSentCopies(): Promise<void> {
  while (pendingCopies.size > 0) {
    await Promise.allSettled([...pendingCopies]);
  }
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
   * `pool` is what makes reuse mean anything. Without it nodemailer opens a
   * connection, sends one message and closes it — so every email paid for a
   * TCP handshake, a TLS handshake and an AUTH round trip before a single byte
   * of the message moved. Against a provider a few hundred milliseconds away
   * that is most of the time an operator spends watching the Send button.
   * Pooled, the second message onwards reuses an authenticated socket.
   *
   * The limits are deliberately modest: shared mail hosts cap concurrent
   * connections per account aggressively, and being throttled is slower than
   * queueing behind three sockets. `maxMessages` recycles a connection before
   * a provider's own per-connection message cap closes it underneath a send.
   *
   * The timeouts matter as much as the pool. A mail host that accepts a socket
   * and then stops talking would otherwise hold the operator's request open
   * until something upstream gave up; these fail it in seconds, and the
   * Notification row records the failure so it can be retried.
   */
  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const { host, port, secure, user, password } = this.options;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      pool: true,
      maxConnections: 3,
      maxMessages: 50,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
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
    const composedAt = performance.now();
    const raw = await new MailComposer(options).compile().build();
    const composeMs = performance.now() - composedAt;

    const sentAt = performance.now();

    const info = await this.getTransporter().sendMail({
      raw,
      // Required with `raw`: the transport reads recipients from the envelope
      // rather than parsing headers back out of the message.
      envelope: { from: this.options.from, to: message.to },
    });

    // Logged on every send, not only a slow one: "the email is slow" is a
    // report nobody can act on, and the three numbers below say whether the
    // time went into building a message full of images or into the provider.
    log.info(
      {
        host: this.options.host,
        bytes: raw.byteLength,
        attachments: message.attachments?.length ?? 0,
        composeMs: Math.round(composeMs),
        sendMs: Math.round(performance.now() - sentAt),
      },
      "SMTP send complete",
    );

    if (this.options.sentCopy) {
      fileSentCopy(this.options.sentCopy, raw);
    }

    // The message's own id first, not nodemailer's. Handed a `raw` buffer it
    // does not read the id back out — it mints a fresh one for `info` that
    // appears nowhere in what was sent, so trusting it would fill
    // `providerReference` with an id that matches nothing in the provider's
    // logs and nothing in the mailbox.
    return { providerReference: messageIdOf(raw) ?? info.messageId };
  }

  /**
   * Closes the pool's idle connections.
   *
   * Required now that the transport pools: an adapter dropped from the cache
   * — because its account was edited or disabled — would otherwise hold its
   * authenticated sockets open for the life of the process, and a provider
   * counts those against the account's connection limit whether or not
   * anything is being sent through them.
   */
  close(): void {
    this.transporter?.close();
    this.transporter = undefined;
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
