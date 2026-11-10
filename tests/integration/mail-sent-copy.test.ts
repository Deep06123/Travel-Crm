import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SmtpMailAdapter } from "@/lib/mail/smtp-adapter";
import { resetSentFolderCache } from "@/lib/mail/sent-copy";

import { ImapSink } from "../helpers/imap-sink";
import { SmtpSink } from "../helpers/smtp-sink";

/**
 * Filing a copy of a sent message in the mailbox's Sent folder.
 *
 * Both ends are real servers on loopback — SMTP accepts the message, IMAP
 * accepts the copy — because the whole point of this feature is that a second
 * server is involved. A mocked IMAP client would prove we call a function; it
 * would not prove an APPEND conversation completes, that the folder we chose
 * is the one the server flags `\Sent`, or that the copy is the same message
 * the customer received.
 *
 * The last of those is the one worth being careful about: the Sent copy has to
 * carry the same Message-ID as the delivered mail, or a customer's reply
 * threads against nothing.
 */

const smtp = new SmtpSink();
const imap = new ImapSink();

let smtpPort: number;
let imapPort: number;

beforeAll(async () => {
  smtpPort = await smtp.start();
  imapPort = await imap.start();
});

afterAll(async () => {
  await smtp.stop();
  await imap.stop();
});

beforeEach(() => {
  smtp.reset();
  imap.reset();
  // Keyed by host and user, and every test here uses the same pair.
  resetSentFolderCache();
});

function adapter(overrides: { sentCopy?: boolean } = {}): SmtpMailAdapter {
  return new SmtpMailAdapter({
    host: "127.0.0.1",
    port: smtpPort,
    secure: false,
    from: "Travel CRM <bookings@example.invalid>",
    ...(overrides.sentCopy === false
      ? {}
      : {
          sentCopy: {
            host: "127.0.0.1",
            port: imapPort,
            secure: false,
            user: imap.user,
            password: imap.password,
          },
        }),
  });
}

const message = {
  to: "customer@example.invalid",
  subject: "Your e-ticket",
  text: "Attached is your e-ticket.",
  html: "<p>Attached is your e-ticket.</p>",
};

describe("saving a copy to the Sent folder", () => {
  it("appends the message to the folder the server flags \\Sent", async () => {
    await adapter().send(message);

    const copy = imap.only();

    // Not "Sent": this server puts it under INBOX, as Hostinger and other
    // Dovecot-based providers do. Guessing the name would have created a
    // stray folder beside the real one.
    expect(copy.mailbox).toBe("INBOX.Sent");
    expect(copy.flags).toEqual(["\\Seen"]);
  });

  it("files the same message that was delivered, Message-ID and all", async () => {
    const result = await adapter().send(message);

    const delivered = smtp.only().data;
    const copy = imap.only().message;

    const messageId = /^message-id:\s*(<[^>]+>)/im.exec(delivered)?.[1];
    expect(messageId).toBeDefined();

    // The identity that makes a reply thread against the copy.
    expect(copy).toContain(messageId!);
    expect(result.providerReference).toBe(messageId);

    // And the rest of it: same subject, same recipient, same body.
    expect(copy).toContain("Subject: Your e-ticket");
    expect(copy).toContain("customer@example.invalid");
    expect(copy).toContain("Attached is your e-ticket.");
  });

  it("appends an attachment-carrying message whole", async () => {
    await adapter().send({
      ...message,
      attachments: [
        {
          filename: "eticket.pdf",
          content: Buffer.from("%PDF-1.4 pretend"),
          contentType: "application/pdf",
        },
      ],
    });

    const copy = imap.only().message;

    expect(copy).toContain("eticket.pdf");
    // Base64 of the content above: the part is carried, not just named.
    expect(copy).toContain(Buffer.from("%PDF-1.4 pretend").toString("base64"));
  });

  it("opens no IMAP connection at all when no copy is configured", async () => {
    await adapter({ sentCopy: false }).send(message);

    expect(smtp.messages).toHaveLength(1);
    expect(imap.connections).toBe(0);
  });
});

describe("when the mailbox will not take the copy", () => {
  it("still sends, and reports the send as successful", async () => {
    imap.rejectAppend = true;

    const result = await adapter().send(message);

    // The customer has their e-ticket. A refused copy is a bookkeeping
    // problem, and throwing here would make it a booking problem.
    expect(smtp.messages).toHaveLength(1);
    expect(imap.appends).toHaveLength(0);
    expect(result.providerReference).toMatch(/^<.+>$/);
  });

  it("still sends when the credentials are refused", async () => {
    imap.rejectLogin = true;

    await expect(adapter().send(message)).resolves.toBeDefined();
    expect(smtp.messages).toHaveLength(1);
    expect(imap.appends).toHaveLength(0);
  });

  it("still sends when there is no IMAP server listening", async () => {
    const unreachable = new SmtpMailAdapter({
      host: "127.0.0.1",
      port: smtpPort,
      secure: false,
      from: "Travel CRM <bookings@example.invalid>",
      sentCopy: {
        host: "127.0.0.1",
        // Port 1 is reserved and never listening, so this refuses at once
        // rather than waiting for the timeout.
        port: 1,
        secure: false,
        user: imap.user,
        password: imap.password,
      },
    });

    await expect(unreachable.send(message)).resolves.toBeDefined();
    expect(smtp.messages).toHaveLength(1);
  });
});
