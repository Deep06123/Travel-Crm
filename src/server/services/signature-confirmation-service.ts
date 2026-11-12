import "server-only";

import { after } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import {
  BookingSignatureStatus,
  NotificationChannel,
  NotificationStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";
import {
  confirmationFilename,
  renderSignatureConfirmation,
} from "@/lib/mail/signature-confirmation";
import { renderConfirmationPdf } from "@/lib/pdf/signature-confirmation";
import type { SignatureEvidence } from "@/lib/signature/evidence";
import { generateStorageKey, getStorage, ObjectNotFoundError } from "@/lib/storage";

import { resolveMailer } from "./mail-account-service";

/**
 * Sending the signed authorization back to the mailbox that asked for it.
 *
 * Separate from `booking-signature-service` on purpose. That module owns the
 * evidence: capturing a signature is a transaction that must either commit
 * entirely or not at all. This module owns a delivery, which is a slow,
 * failure-prone conversation with a third party that may legitimately be
 * retried hours later. Running the second inside the first would mean a mail
 * server timing out could roll back a signature the customer has already been
 * told was accepted — the one outcome this flow must never produce.
 *
 * The destination is read from the signature row, never resolved afresh. The
 * invitation may have gone out weeks ago from an account that is no longer the
 * default, and the signed document belongs in the conversation it started.
 *
 * Idempotency rests on the Notification table's unique `dedupeKey` rather than
 * on a flag anywhere here: a second process attempting the same confirmation
 * loses the insert and stops, which is a guarantee two application instances
 * can rely on and an in-memory check is not.
 */

const log = loggerFor("signature-confirmation");

export const BOOKING_AUTHORIZATION_CONFIRMATION =
  "BOOKING_AUTHORIZATION_CONFIRMATION";

const TEMPLATE = "signature-confirmation";

const UNIQUE_VIOLATION = "P2002";

/** One confirmation per signature, forever. */
function dedupeKeyFor(signatureId: string): string {
  return `signature:${signatureId}:confirmation`;
}

export type ConfirmationResult =
  | { result: "sent"; recipient: string; sentFrom: string }
  | { result: "duplicate" }
  | { result: "suppressed"; reason: string }
  | { result: "failed"; reason: string };

const SIGNATURE_SELECT = {
  id: true,
  status: true,
  recipientEmail: true,
  senderEmail: true,
  senderMailAccountId: true,
  confirmationPdfKey: true,
  viewedAt: true,
  signedAt: true,
  signatureName: true,
  signedPhone: true,
  consentText: true,
  ipAddress: true,
  device: true,
  operatingSystem: true,
  browser: true,
  screenSize: true,
  clientTimezone: true,
  geoCity: true,
  geoRegion: true,
  geoCountry: true,
  bookingId: true,
  booking: {
    select: {
      bookingNumber: true,
      product: true,
      totalMinor: true,
      currency: true,
      contactName: true,
      customer: { select: { firstName: true, lastName: true } },
    },
  },
} as const;

type SignatureRow = Prisma.BookingSignatureGetPayload<{
  select: typeof SIGNATURE_SELECT;
}>;

/**
 * The row as the renderers want it.
 *
 * Returns null when the row is not actually signed evidence — a request that
 * has not been signed has no `signedAt`, and a document dated from a fallback
 * clock would be worse than no document.
 */
function toEvidence(row: SignatureRow): SignatureEvidence | null {
  if (!row.signedAt) return null;

  const { booking } = row;
  const customerName =
    booking.contactName?.trim() ||
    `${booking.customer.firstName} ${booking.customer.lastName}`.trim();

  return {
    signatureId: row.id,
    bookingNumber: booking.bookingNumber,
    customerName,
    product: booking.product,
    totalMinor: booking.totalMinor,
    currency: booking.currency,
    signatureName: row.signatureName ?? "",
    signedPhone: row.signedPhone ?? "",
    consentText: row.consentText ?? "",
    recipientEmail: row.recipientEmail,
    viewedAt: row.viewedAt,
    signedAt: row.signedAt,
    ipAddress: row.ipAddress,
    device: row.device,
    operatingSystem: row.operatingSystem,
    browser: row.browser,
    screenSize: row.screenSize,
    clientTimezone: row.clientTimezone,
    geoCity: row.geoCity,
    geoRegion: row.geoRegion,
    geoCountry: row.geoCountry,
  };
}

/**
 * The stored PDF, rendering it only if there is not one already.
 *
 * A retry must attach the same bytes the first attempt did. Re-rendering would
 * produce a document that differs in its creation metadata from the one that
 * may already be in somebody's inbox, and two versions of a piece of evidence
 * is a question nobody wants to answer in a dispute.
 *
 * A key that no longer resolves — storage pruned, a bucket replaced — falls
 * through to a fresh render rather than failing the send, and the new key
 * replaces the dangling one.
 */
async function ensureConfirmationPdf(
  row: SignatureRow,
  evidence: SignatureEvidence,
): Promise<Buffer> {
  const storage = getStorage();

  if (row.confirmationPdfKey) {
    try {
      return await storage.get(row.confirmationPdfKey);
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;

      log.warn(
        { signatureId: row.id, key: row.confirmationPdfKey },
        "Stored confirmation PDF is missing; rendering it again",
      );
    }
  }

  const bytes = await renderConfirmationPdf(evidence);
  const key = generateStorageKey("pdf", "documents");

  await storage.put({ key, body: bytes, contentType: "application/pdf" });

  await prisma.bookingSignature.update({
    where: { id: row.id },
    data: { confirmationPdfKey: key },
  });

  return bytes;
}

/**
 * The signed authorization for a booking, as bytes an operator can download.
 *
 * Reads the same stored object the confirmation email attached, and renders
 * one only if nothing is stored — so the file an operator downloads for a
 * chargeback is byte-identical to the one already sent, rather than a second
 * rendering of the same evidence with different timestamps that a bank would
 * be entitled to ask about.
 *
 * The *earliest* signed request, which is the one the bookings list dates in
 * its authorization column. A booking signed twice would otherwise show one
 * date on screen and hand over a document bearing another, and reconciling
 * those is nobody's idea of a good afternoon.
 *
 * Null when the booking has no signed authorization at all — there is no
 * document, and inventing an unsigned one would be worse than saying so.
 */
export async function signedAuthorizationPdf(
  bookingId: string,
): Promise<{ bytes: Buffer; filename: string } | null> {
  const row = await prisma.bookingSignature.findFirst({
    where: { bookingId, signedAt: { not: null } },
    orderBy: { signedAt: "asc" },
    select: SIGNATURE_SELECT,
  });

  if (!row) return null;

  const evidence = toEvidence(row);
  if (!evidence) return null;

  return {
    bytes: await ensureConfirmationPdf(row, evidence),
    filename: confirmationFilename(evidence.bookingNumber),
  };
}

/**
 * Claims the right to send this confirmation.
 *
 * The insert is the lock. `dedupeKey` is unique, so exactly one caller creates
 * the row and every other one loses on the constraint — including a caller in
 * a different process, which is why this is a database constraint rather than
 * a check-then-act in memory.
 *
 * `null` means somebody else has it.
 */
async function claim(
  signatureId: string,
  bookingId: string,
  recipient: string,
  bookingNumber: string,
): Promise<string | null> {
  try {
    const row = await prisma.notification.create({
      data: {
        dedupeKey: dedupeKeyFor(signatureId),
        bookingId,
        eventType: BOOKING_AUTHORIZATION_CONFIRMATION,
        channel: NotificationChannel.EMAIL,
        template: TEMPLATE,
        recipient,
        status: NotificationStatus.PENDING,
        attemptCount: 0,
        payload: { bookingNumber, signatureId },
      },
      select: { id: true },
    });

    return row.id;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      return null;
    }

    throw error;
  }
}

export interface DeliverConfirmationOptions {
  /**
   * Re-attempt an existing failed confirmation rather than claiming a new one.
   *
   * Refuses anything that is not already FAILED, so "retry" cannot be used to
   * send a second copy of something that was delivered.
   */
  retry?: boolean;
}

/**
 * Emails the signed authorization to the address the invitation came from.
 *
 * Awaited by its caller only in the retry path, where an operator is watching.
 * The signing path dispatches it — see `dispatchSignatureConfirmation`.
 */
export async function deliverSignatureConfirmation(
  signatureId: string,
  { retry = false }: DeliverConfirmationOptions = {},
): Promise<ConfirmationResult> {
  const row = await prisma.bookingSignature.findUnique({
    where: { id: signatureId },
    select: SIGNATURE_SELECT,
  });

  if (!row) {
    return { result: "suppressed", reason: "That signature no longer exists." };
  }

  if (row.status !== BookingSignatureStatus.SIGNED) {
    return {
      result: "suppressed",
      reason: "The authorization has not been signed, so there is nothing to confirm.",
    };
  }

  const evidence = toEvidence(row);

  if (!evidence) {
    return {
      result: "suppressed",
      reason: "The signature has no recorded time, so no confirmation can be produced.",
    };
  }

  const recipient = row.senderEmail?.trim();

  // Nothing was captured when the invitation went out — either it predates
  // this feature or it was issued on a machine with no transport at all.
  // Guessing an address from today's default would send the evidence to a
  // mailbox that never asked for it.
  if (!recipient) {
    const reason =
      "No sender address was recorded when the invitation was sent, so there is nowhere to send the confirmation.";

    await recordSuppression(signatureId, row.bookingId, row.booking.bookingNumber, reason);
    log.warn({ signatureId }, "Confirmation suppressed: no recorded sender");

    return { result: "suppressed", reason };
  }

  let notificationId: string;

  if (retry) {
    const existing = await prisma.notification.findUnique({
      where: { dedupeKey: dedupeKeyFor(signatureId) },
      select: { id: true, status: true },
    });

    if (!existing) {
      return {
        result: "suppressed",
        reason: "There is no confirmation attempt on record to retry.",
      };
    }

    if (existing.status !== NotificationStatus.FAILED) {
      // SENT, PENDING or SUPPRESSED. Retrying a SENT one would deliver a
      // second copy; retrying a PENDING one would race the attempt in flight.
      return { result: "duplicate" };
    }

    notificationId = existing.id;
  } else {
    const claimed = await claim(
      signatureId,
      row.bookingId,
      recipient,
      row.booking.bookingNumber,
    );

    if (!claimed) return { result: "duplicate" };

    notificationId = claimed;
  }

  // The identity that sent the invitation, by id. `resolveMailer` falls back
  // on its own when that account has since been disabled or deleted, and the
  // label it returns is what the operator is shown — so a fallback is visible
  // rather than silent.
  const mailer = await resolveMailer(
    "authorization",
    row.senderMailAccountId ?? undefined,
  );

  if (!mailer) {
    const reason =
      "No sending account is configured, so the confirmation was not attempted.";

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.SUPPRESSED, lastError: reason },
    });

    log.warn({ signatureId }, "Confirmation suppressed: no transport");
    return { result: "suppressed", reason };
  }

  if (row.senderMailAccountId && mailer.accountId !== row.senderMailAccountId) {
    log.warn(
      {
        signatureId,
        intended: row.senderMailAccountId,
        used: mailer.accountId,
      },
      "Original sending account is unavailable; confirmation sent from the fallback",
    );
  }

  try {
    const pdf = await ensureConfirmationPdf(row, evidence);
    const rendered = renderSignatureConfirmation(evidence);

    // Addressed to the office, but written to read as the customer's reply:
    // the display name is theirs and a reply goes to them rather than to the
    // account that sent it. The address stays ours — see `MailMessage.fromName`
    // for why sending as the customer is not an option.
    //
    // Only when there is an address to reply to. A `From` name that says
    // "Grace Hopper" over a Reply-To that silently falls back to the office
    // would send an answer meant for the customer back to the office.
    const customerEmail = evidence.recipientEmail.trim();

    const { providerReference } = await mailer.adapter.send({
      to: recipient,
      ...(customerEmail
        ? {
            replyTo: customerEmail,
            fromName: `${evidence.customerName} (customer)`,
          }
        : {}),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      attachments: [
        {
          filename: confirmationFilename(evidence.bookingNumber),
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });

    // SENT only now, with the provider's acceptance in hand. Writing it before
    // the send would be a row claiming a delivery that had merely been
    // attempted.
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        attemptCount: { increment: 1 },
        provider: mailer.adapter.provider,
        lastError: null,
        ...(mailer.accountId ? { mailAccountId: mailer.accountId } : {}),
        ...(providerReference ? { providerReference } : {}),
      },
    });

    log.info({ signatureId, recipient }, "Signature confirmation sent");

    return { result: "sent", recipient, sentFrom: mailer.label };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown transport error";

    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: NotificationStatus.FAILED,
        lastError: reason,
        attemptCount: { increment: 1 },
        provider: mailer.adapter.provider,
        ...(mailer.accountId ? { mailAccountId: mailer.accountId } : {}),
      },
    });

    log.error({ err: error, signatureId }, "Signature confirmation failed");

    return { result: "failed", reason };
  }
}

/**
 * Records that a confirmation was never attempted.
 *
 * Upserted on the dedupe key so a signature with no sender does not accumulate
 * one row per restart, and so a later retry has something to find.
 */
async function recordSuppression(
  signatureId: string,
  bookingId: string,
  bookingNumber: string,
  reason: string,
): Promise<void> {
  const dedupeKey = dedupeKeyFor(signatureId);

  await prisma.notification.upsert({
    where: { dedupeKey },
    create: {
      dedupeKey,
      bookingId,
      eventType: BOOKING_AUTHORIZATION_CONFIRMATION,
      channel: NotificationChannel.EMAIL,
      template: TEMPLATE,
      recipient: "",
      status: NotificationStatus.SUPPRESSED,
      attemptCount: 0,
      lastError: reason,
      payload: { bookingNumber, signatureId },
    },
    update: { status: NotificationStatus.SUPPRESSED, lastError: reason },
  });
}

/** How the booking page describes this confirmation's delivery. */
export interface ConfirmationStatus {
  status: NotificationStatus;
  recipient: string;
  sentAt: Date | null;
  lastError: string | null;
  attemptCount: number;
}

export async function getConfirmationStatus(
  signatureId: string,
): Promise<ConfirmationStatus | null> {
  const row = await prisma.notification.findUnique({
    where: { dedupeKey: dedupeKeyFor(signatureId) },
    select: {
      status: true,
      recipient: true,
      sentAt: true,
      lastError: true,
      attemptCount: true,
    },
  });

  return row;
}

/** Sends dispatched in the background, for tests that must not race them. */
const inFlight = new Set<Promise<unknown>>();

/**
 * Sends the confirmation without making the customer wait for it.
 *
 * The same shape as `dispatchAdminNotice`, and for the same reason: a bare
 * floating promise races the response and can be abandoned half-way on a
 * platform that freezes the process between invocations. `after()` hands the
 * work to the runtime once the response is flushed, and the fallback covers
 * seeds, scripts and tests, which run outside any request scope.
 *
 * The customer's "thank you" must never be held up by — or failed by — a mail
 * server. Whether the office got its copy is on the Notification row, and an
 * operator can retry it from the booking.
 */
export function dispatchSignatureConfirmation(signatureId: string): void {
  const run = () => {
    const promise = deliverSignatureConfirmation(signatureId)
      .catch((error: unknown) => {
        log.error(
          { err: error, signatureId },
          "Signature confirmation dispatch threw unexpectedly",
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

export async function flushPendingSignatureConfirmations(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}
