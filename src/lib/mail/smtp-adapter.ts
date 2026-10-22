import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import type { MailAdapter, MailMessage, MailResult } from "./types";

export interface SmtpAdapterOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  password?: string | undefined;
  from: string;
  replyTo?: string | undefined;
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
    const info = await this.getTransporter().sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ?? this.options.replyTo
        ? { replyTo: message.replyTo ?? this.options.replyTo }
        : {}),
    });

    return { providerReference: info.messageId };
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
