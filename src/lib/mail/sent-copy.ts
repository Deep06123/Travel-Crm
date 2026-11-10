import "server-only";

import { ImapFlow } from "imapflow";

import { loggerFor } from "@/lib/logging/logger";

const log = loggerFor("mail-sent-copy");

/**
 * Filing a copy of an outgoing message in the mailbox's Sent folder.
 *
 * Saving to Sent is not part of SMTP. A submission server accepts a message
 * and relays it; nothing obliges it to keep a copy, and most do not. Gmail is
 * the exception people generalise from — it files anything sent through
 * `smtp.gmail.com` automatically — but Hostinger, Titan, SES and the rest do
 * not, which is why mail this application sent successfully was nowhere to be
 * seen in the mailbox it came from.
 *
 * What fills the folder on every other provider is the *client*: Thunderbird,
 * Outlook and webmail all perform a second, separate IMAP `APPEND` after the
 * send. This module is that second step, and nothing more.
 *
 * Two rules it must never break:
 *
 *   - It cannot fail a send. The customer has their e-ticket; a mailbox that
 *     refuses the copy is a bookkeeping problem, and throwing here would turn
 *     it into a booking problem.
 *   - It cannot hang one either. An IMAP server that accepts the TCP
 *     connection and then stops talking would otherwise hold an operator's
 *     request open until something upstream gave up.
 */

export interface SentCopyOptions {
  host: string;
  port: number;
  /** True for implicit TLS on 993, which is what every IMAP host still uses. */
  secure: boolean;
  user: string;
  password: string;
  /**
   * Mailbox to append to. Left undefined, the folder flagged `\Sent` by the
   * server is used — the names differ by provider (`Sent`, `INBOX.Sent`,
   * `Sent Items`) and guessing wrong creates a stray folder.
   */
  mailbox?: string | undefined;
}

/** Long enough for a slow mailbox, short enough not to hold a request open. */
const APPEND_TIMEOUT_MS = 15_000;

/**
 * Discovered Sent folders, keyed by host and user.
 *
 * The `LIST` that finds it is a round trip per send otherwise, and the answer
 * changes about as often as the mailbox is recreated. A process restart is
 * enough to pick up a change, which is the right price for this.
 */
const discovered = new Map<string, string>();

/** Fallbacks for a server that advertises no special-use flags at all. */
const COMMON_SENT_NAMES = ["Sent", "INBOX.Sent", "Sent Items", "Sent Messages"];

/**
 * The IMAP host for an SMTP host, where that can be known rather than guessed.
 *
 * Providers that run both on the same domain follow one of two conventions,
 * and this covers them: `smtp.example.com` pairs with `imap.example.com`, and
 * a combined `mail.example.com` serves both. Anything else returns undefined
 * and no copy is attempted — a local catcher like Mailpit has no IMAP at all,
 * and a wrong guess means a failed connection on every single send.
 *
 * An account that needs something else sets its IMAP host explicitly.
 */
export function deriveImapHost(smtpHost: string): string | undefined {
  const host = smtpHost.trim().toLowerCase();

  if (host.startsWith("smtp.")) return `imap.${host.slice("smtp.".length)}`;
  if (host.startsWith("mail.")) return host;

  return undefined;
}

/** Finds the Sent folder, preferring what the server itself says it is. */
async function resolveMailbox(
  client: ImapFlow,
  options: SentCopyOptions,
): Promise<string> {
  if (options.mailbox) return options.mailbox;

  const cacheKey = `${options.host}:${options.user}`;
  const cached = discovered.get(cacheKey);
  if (cached) return cached;

  const mailboxes = await client.list();

  // `\Sent` is the answer when the server offers SPECIAL-USE; imapflow also
  // fills it in by matching known localised folder names, which covers the
  // older servers that do not.
  const flagged = mailboxes.find((box) => box.specialUse === "\\Sent");
  const byName = mailboxes.find((box) => COMMON_SENT_NAMES.includes(box.path));

  const path = flagged?.path ?? byName?.path ?? "Sent";

  discovered.set(cacheKey, path);
  return path;
}

/** Clears the discovered-folder cache. Test seam, and used after an edit. */
export function resetSentFolderCache(): void {
  discovered.clear();
}

/**
 * Appends one already-sent message to the Sent folder.
 *
 * `raw` must be the exact bytes handed to the SMTP server, so the copy carries
 * the same Message-ID as the message the customer received — that identity is
 * what threads their reply against it.
 *
 * Marked `\Seen`, because a message you sent is not unread mail.
 */
export async function appendToSentFolder(
  options: SentCopyOptions,
  raw: Buffer,
): Promise<{ mailbox: string }> {
  const client = new ImapFlow({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.user, pass: options.password },
    // The library logs every command at info level otherwise, which buries
    // the application's own log in IMAP chatter.
    logger: false,
  });

  try {
    await client.connect();

    const mailbox = await resolveMailbox(client, options);
    await client.append(mailbox, raw, ["\\Seen"], new Date());

    return { mailbox };
  } finally {
    // `logout` on a connection that never opened throws over the original
    // error, which would replace a useful reason with a confusing one.
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

/**
 * `appendToSentFolder`, bounded and swallowed.
 *
 * This is what the send path calls: a failure is logged with enough to act on
 * and then dropped, because the message is already delivered and there is
 * nothing useful a caller could do with the error.
 */
export async function trySaveToSentFolder(
  options: SentCopyOptions,
  raw: Buffer,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      appendToSentFolder(options, raw),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`IMAP append timed out after ${APPEND_TIMEOUT_MS}ms`)),
          APPEND_TIMEOUT_MS,
        );
      }),
    ]);

    log.debug(
      { host: options.host, mailbox: result.mailbox },
      "Saved a copy to the Sent folder",
    );
    return true;
  } catch (error) {
    log.warn(
      { err: error, host: options.host, user: options.user },
      "Could not save a copy to the Sent folder; the message was still sent",
    );
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
