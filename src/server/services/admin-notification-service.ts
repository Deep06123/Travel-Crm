import "server-only";

import { after } from "next/server";

import {
  AuditAction,
  NotificationChannel,
  NotificationStatus,
} from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";
import { getMailer } from "@/lib/mail";
import {
  renderAdminNotice,
  type AdminNoticeRow,
} from "@/lib/mail/admin-notice";

/**
 * The internal copy of a customer email.
 *
 * The business wants to know, in its own mailbox, that an authorization went
 * out, that the customer signed it, and that a confirmation or e-ticket
 * reached them. The addresses that receive those notices are operator
 * configuration, not deployment configuration, so they live in
 * `BusinessSetting` beside the email policy wording rather than in the
 * environment: an administrator changes who is copied without a redeploy, and
 * the change is audited like any other settings change.
 *
 * Three rules shape what follows.
 *
 * An internal notice must never be able to fail a customer send. Every caller
 * dispatches rather than awaits, and the dispatch swallows its own errors —
 * the customer's email has already left, and a copy that did not arrive is a
 * smaller problem than an operator shown a failure for a send that worked.
 *
 * Absence means off. No row, or a row holding an empty list, is a deployment
 * that does not want internal copies; it is not an error and it is not logged
 * as one. That is also the state every existing installation starts in, so
 * nothing begins emailing an address nobody configured.
 *
 * And the Notification row says what actually happened, exactly as the
 * customer-facing services do. These rows carry no `dedupeKey`: a second
 * authorization email is a second real event and deserves a second notice.
 */

const log = loggerFor("admin-notification");

/** Named for the settings table, where the key is shown to an administrator. */
export const ADMIN_NOTIFICATION_SETTING_KEY = "admin_notification_emails";

/** Enough for a small operations team; past this it wants a mailing list. */
export const MAX_ADMIN_NOTIFICATION_EMAILS = 10;

/** The events an internal notice is sent for. */
export const ADMIN_AUTHORIZATION_SENT = "ADMIN_AUTHORIZATION_SENT";
export const ADMIN_AUTHORIZATION_SIGNED = "ADMIN_AUTHORIZATION_SIGNED";
export const ADMIN_CUSTOMER_EMAIL_SENT = "ADMIN_CUSTOMER_EMAIL_SENT";

export type AdminNoticeEvent =
  | typeof ADMIN_AUTHORIZATION_SENT
  | typeof ADMIN_AUTHORIZATION_SIGNED
  | typeof ADMIN_CUSTOMER_EMAIL_SENT;

/**
 * Deliberately permissive.
 *
 * The authority on whether an address exists is the mail transport, not a
 * regular expression here. This rejects what is obviously not an address —
 * spaces, a missing `@`, a domain with no dot — so a typo is caught at the
 * form rather than silently never delivering, and leaves the rest to SMTP.
 */
const ADDRESS = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export class AdminNotificationValidationError extends Error {}

/** Splits on commas and newlines, dropping blanks and case-insensitive repeats. */
export function parseAddressList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of value.split(/[,\n;]/)) {
    const address = part.trim();
    if (address === "") continue;

    const key = address.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(address);
  }

  return out;
}

/** Decodes the stored JSON column, dropping anything that is not an address. */
function toAddresses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && ADDRESS.test(entry));
}

/**
 * Who receives the internal copies, or an empty list when nobody does.
 *
 * Never throws. A settings lookup that fails must not take a customer email
 * down with it, so the failure is logged and treated as "not configured".
 */
export async function loadAdminNotificationEmails(): Promise<string[]> {
  try {
    const row = await prisma.businessSetting.findUnique({
      where: { key: ADMIN_NOTIFICATION_SETTING_KEY },
      select: { value: true },
    });

    return row ? toAddresses(row.value) : [];
  } catch (error) {
    log.error({ err: error }, "Could not load admin notification addresses");
    return [];
  }
}

/**
 * Replaces the configured addresses.
 *
 * An empty list deletes the row rather than storing `[]`. The two would behave
 * identically — nothing is copied either way — and one stored state for one
 * behaviour means the settings table never shows an empty row an administrator
 * has to interpret.
 *
 * Returns what was stored, so the form can redraw from the parsed and
 * deduplicated list rather than the raw text somebody typed.
 */
export async function saveAdminNotificationEmails(
  raw: string,
  actorId: string,
): Promise<string[]> {
  const addresses = parseAddressList(raw);

  if (addresses.length > MAX_ADMIN_NOTIFICATION_EMAILS) {
    throw new AdminNotificationValidationError(
      `That is ${addresses.length} addresses; the limit is ${MAX_ADMIN_NOTIFICATION_EMAILS}. Use a distribution list for more.`,
    );
  }

  const invalid = addresses.find((address) => !ADDRESS.test(address));
  if (invalid) {
    throw new AdminNotificationValidationError(
      `"${invalid}" is not an email address. Separate addresses with a comma or a new line.`,
    );
  }

  const before = await loadAdminNotificationEmails();

  if (addresses.length === 0) {
    const deleted = await prisma.businessSetting.deleteMany({
      where: { key: ADMIN_NOTIFICATION_SETTING_KEY },
    });

    // Nothing was configured and nothing is now. Auditing that would put an
    // entry in the trail for a button press that changed no state.
    if (deleted.count === 0) return [];
  } else {
    await prisma.businessSetting.upsert({
      where: { key: ADMIN_NOTIFICATION_SETTING_KEY },
      create: {
        key: ADMIN_NOTIFICATION_SETTING_KEY,
        value: addresses,
        description:
          "Internal copies of authorization emails, customer signatures and customer emails go to these addresses.",
      },
      update: { value: addresses },
    });
  }

  await recordAudit({
    action: AuditAction.UPDATE,
    entityType: "BusinessSetting",
    entityId: ADMIN_NOTIFICATION_SETTING_KEY,
    adminUserId: actorId,
    summary:
      addresses.length === 0
        ? "Turned off internal email notifications"
        : `Set internal email notifications to ${addresses.join(", ")}`,
    changes: { addresses: { before, after: addresses } },
  });

  return addresses;
}

/**
 * The agent's name for a notice line.
 *
 * Their id is meaningless in a mailbox, and a notice that cannot name them is
 * still worth sending — so a lookup that fails yields `null`, and the row is
 * dropped rather than the notice.
 */
export async function actorName(
  actorId: string | null | undefined,
): Promise<string | null> {
  if (!actorId) return null;

  try {
    const user = await prisma.adminUser.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    return user?.name?.trim() || null;
  } catch (error) {
    log.error({ err: error, actorId }, "Could not resolve the acting agent");
    return null;
  }
}

/**
 * The deployment's public address, for the link in a notice.
 *
 * `AUTH_URL` only. Unlike the signing link, there is no request to fall back
 * on — a notice is dispatched after the response has been flushed, and may be
 * triggered by a customer's own request where the host header is the public
 * signing domain. A notice with no link is still useful; one pointing at the
 * wrong host is worse than none.
 */
function bookingUrl(bookingId: string): string | null {
  const configured = getEnv().AUTH_URL?.trim();
  if (!configured) return null;

  try {
    return `${new URL(configured).origin}/admin/bookings/${bookingId}`;
  } catch {
    return null;
  }
}

export interface AdminNoticeInput {
  bookingId: string;
  bookingNumber: string;
  event: AdminNoticeEvent;
  /** The sentence at the top of the notice and in its subject. */
  headline: string;
  rows: readonly AdminNoticeRow[];
  footnote?: string | null;
}

export type AdminNoticeResult =
  | { result: "sent" }
  | { result: "suppressed"; reason: string }
  | { result: "failed"; reason: string };

/**
 * Sends one internal notice and records it.
 *
 * Returns rather than throws, in every branch. Nothing upstream of this can do
 * anything useful with an exception — the customer's email has already gone —
 * so the outcome belongs on the Notification row and in the log.
 */
export async function sendAdminNotice({
  bookingId,
  bookingNumber,
  event,
  headline,
  rows,
  footnote,
}: AdminNoticeInput): Promise<AdminNoticeResult> {
  const recipients = await loadAdminNotificationEmails();

  // Not configured. Silent and unrecorded on purpose: a Notification row per
  // customer email saying "nobody wanted a copy" would bury the rows that
  // describe real sends.
  if (recipients.length === 0) {
    return { result: "suppressed", reason: "No internal notification addresses are configured." };
  }

  const recipient = recipients.join(", ");

  const record = async (
    status: NotificationStatus,
    extra: { lastError?: string; sentAt?: Date; providerReference?: string } = {},
  ) =>
    prisma.notification.create({
      data: {
        // No dedupeKey: a second authorization email is a second real event,
        // and its notice must not be swallowed as a duplicate of the first.
        bookingId,
        eventType: event,
        channel: NotificationChannel.EMAIL,
        template: "admin-notice",
        recipient,
        status,
        attemptCount: status === NotificationStatus.SUPPRESSED ? 0 : 1,
        provider: status === NotificationStatus.SUPPRESSED ? null : "smtp",
        payload: { bookingNumber, headline },
        ...extra,
      },
      select: { id: true },
    });

  const mailer = getMailer();

  if (!mailer) {
    const reason =
      'No mail transport is configured (MAIL_DRIVER="none"), so no internal notice was attempted.';
    await record(NotificationStatus.SUPPRESSED, { lastError: reason });
    return { result: "suppressed", reason };
  }

  const rendered = renderAdminNotice({
    headline,
    bookingNumber,
    bookingUrl: bookingUrl(bookingId),
    rows,
    ...(footnote ? { footnote } : {}),
  });

  try {
    const { providerReference } = await mailer.send({
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });

    await record(NotificationStatus.SENT, {
      sentAt: new Date(),
      ...(providerReference ? { providerReference } : {}),
    });

    log.info({ bookingId, event }, "Internal notice sent");

    return { result: "sent" };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown transport error";
    await record(NotificationStatus.FAILED, { lastError: reason });
    log.error({ err: error, bookingId, event }, "Internal notice failed");
    return { result: "failed", reason };
  }
}

/** Sends dispatched in the background, for tests that must not race them. */
const inFlight = new Set<Promise<unknown>>();

/**
 * Fires an internal notice without making anybody wait for it.
 *
 * The same shape as `dispatchBookingEmail`, and for the same reason: a bare
 * floating promise races the response and can be abandoned half-way on a
 * platform that freezes the process between invocations. `after()` hands the
 * work to the runtime once the response is flushed, and the fallback covers
 * seeds, scripts and tests, which run outside any request scope.
 */
export function dispatchAdminNotice(input: AdminNoticeInput): void {
  const run = () => {
    const promise = sendAdminNotice(input)
      .catch((error: unknown) => {
        log.error(
          { err: error, bookingId: input.bookingId, event: input.event },
          "Internal notice dispatch threw unexpectedly",
        );
      })
      .finally(() => inFlight.delete(promise));

    inFlight.add(promise);
    return promise;
  };

  try {
    after(run);
  } catch {
    void run();
  }
}

export async function flushPendingAdminNotices(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}
