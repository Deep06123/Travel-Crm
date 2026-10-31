import "server-only";

import {
  BookingProduct,
  NotificationChannel,
  NotificationStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";
import { getMailer } from "@/lib/mail";
import {
  renderBookingAuthorization,
  type BookingAuthorizationData,
} from "@/lib/mail/booking-authorization";

import { createSignatureRequest } from "./booking-signature-service";

/**
 * Sending a customer the authorization email, and recording that it went.
 *
 * Kept out of `customer-email-service` on purpose. That module is built around
 * status-driven mail: one message per booking per lifecycle event, deduplicated
 * on a unique key so a booking that re-enters a status cannot send the same
 * confirmation twice. This message is the opposite shape — an agent sends it
 * when they judge the booking ready, may legitimately send it again, and each
 * send mints a token that invalidates the one before. Forcing it through the
 * dedupe path would mean fighting the design rather than using it.
 *
 * What is shared is the honesty rule: the Notification row says what actually
 * happened. SENT means the provider accepted the message, never that a row was
 * created or a template rendered.
 */

const log = loggerFor("booking-authorization");

export const BOOKING_AUTHORIZATION = "BOOKING_AUTHORIZATION";

export type AuthorizationSendResult =
  | { result: "sent"; signatureId: string; recipient: string; expiresAt: Date }
  | { result: "suppressed"; reason: string }
  | { result: "failed"; reason: string };

const AUTHORIZATION_SELECT = {
  id: true,
  bookingNumber: true,
  product: true,
  currency: true,
  totalMinor: true,
  travelStartDate: true,
  airlineConfirmation: true,
  customEmailSubject: true,
  emailTopHeading: true,
  bookedAt: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  cardHolderName: true,
  cardType: true,
  cardLast4: true,
  billingAddressLine1: true,
  billingAddressLine2: true,
  billingCity: true,
  billingState: true,
  billingPostalCode: true,
  billingCountry: true,
  customer: { select: { firstName: true, lastName: true, email: true } },
  segments: {
    orderBy: { sequence: "asc" },
    select: {
      airline: true,
      flightNumber: true,
      origin: true,
      destination: true,
      departureAt: true,
      arrivalAt: true,
    },
  },
  cruiseDetail: {
    select: {
      cruiseLine: true,
      ship: true,
      departurePort: true,
      sailDate: true,
      returnDate: true,
      nights: true,
    },
  },
  // Passport numbers are deliberately not selected, as in the lifecycle
  // emails: the safest guarantee that none reaches a mailbox is never loading
  // one.
  passengers: {
    orderBy: { sequence: "asc" },
    select: {
      firstName: true,
      lastName: true,
      ticketNumber: true,
      gender: true,
      dateOfBirth: true,
    },
  },
  chargeSplits: {
    orderBy: { sequence: "asc" },
    select: { title: true, amountMinor: true },
  },
  tfn: { select: { number: true } },
} as const;

/** Derived from the select above, so adding a field cannot desync the two. */
type AuthorizationRow = Prisma.BookingGetPayload<{
  select: typeof AUTHORIZATION_SELECT;
}>;

/** One line, in the order a postal address is read. */
function billingAddress(booking: AuthorizationRow): string | null {
  const parts = [
    booking.billingAddressLine1,
    booking.billingAddressLine2,
    booking.billingCity,
    booking.billingState,
    booking.billingPostalCode,
    booking.billingCountry,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : null;
}

function toAuthorizationData(booking: AuthorizationRow): BookingAuthorizationData {
  const customerName =
    booking.contactName?.trim() ||
    `${booking.customer.firstName} ${booking.customer.lastName}`.trim() ||
    "traveller";

  return {
    bookingNumber: booking.bookingNumber,
    customerName,
    product: booking.product === BookingProduct.CRUISE ? "CRUISE" : "FLIGHT",
    currency: booking.currency,
    totalMinor: booking.totalMinor,
    travelStartDate: booking.travelStartDate,
    airlineConfirmation: booking.airlineConfirmation,
    segments: booking.segments,
    cruise: booking.cruiseDetail,
    passengers: booking.passengers,
    customEmailSubject: booking.customEmailSubject,
    emailTopHeading: booking.emailTopHeading,
    supportPhone: booking.tfn?.number ?? null,
    bookedAt: booking.bookedAt,
    contactEmail: booking.contactEmail ?? booking.customer.email,
    contactPhone: booking.contactPhone,
    cardHolderName: booking.cardHolderName,
    cardType: booking.cardType,
    cardLast4: booking.cardLast4,
    billingAddress: billingAddress(booking),
    chargeSplits: booking.chargeSplits,
  };
}

export interface SendAuthorizationInput {
  bookingId: string;
  actorId: string;
  /** Absolute origin the signing link is built against, e.g. `https://crm.example.com`. */
  origin: string;
}

/**
 * Emails the customer their authorization link.
 *
 * Awaited rather than dispatched in the background, unlike the lifecycle mail.
 * This is explicit operator intent and the token it mints is only useful if it
 * actually left the building, so the agent is told the outcome instead of being
 * sent back to the page to guess.
 *
 * The token is minted *before* the send, so a message that reaches the customer
 * always has a working link behind it. The cost is a revoked-but-unused row
 * when the transport rejects the message, which is the harmless direction to
 * fail in: the agent sees the failure and sends again.
 */
export async function sendAuthorizationEmail({
  bookingId,
  actorId,
  origin,
}: SendAuthorizationInput): Promise<AuthorizationSendResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: AUTHORIZATION_SELECT,
  });

  if (!booking) {
    throw new Error(`Booking ${bookingId} does not exist.`);
  }

  const recipient =
    booking.contactEmail?.trim() || booking.customer.email?.trim() || null;

  const record = async (
    status: NotificationStatus,
    extra: { lastError?: string; sentAt?: Date; providerReference?: string } = {},
  ) =>
    prisma.notification.create({
      data: {
        // No dedupe key: a resend is a legitimate second message, not a
        // duplicate of the first. The column is nullable precisely for this.
        bookingId,
        eventType: BOOKING_AUTHORIZATION,
        channel: NotificationChannel.EMAIL,
        template: "booking-authorization",
        recipient: recipient ?? "",
        status,
        attemptCount: status === NotificationStatus.SUPPRESSED ? 0 : 1,
        provider: status === NotificationStatus.SUPPRESSED ? null : "smtp",
        payload: { bookingNumber: booking.bookingNumber },
        ...extra,
      },
      select: { id: true },
    });

  if (!recipient) {
    const reason =
      "No contact email on the booking or the customer record, so there is nowhere to send it.";
    await record(NotificationStatus.SUPPRESSED, { lastError: reason });
    log.warn({ bookingId }, "Authorization email suppressed: no recipient");
    return { result: "suppressed", reason };
  }

  const mailer = getMailer();

  if (!mailer) {
    const reason =
      'No mail transport is configured (MAIL_DRIVER="none"), so no email was attempted.';
    await record(NotificationStatus.SUPPRESSED, { lastError: reason });
    log.warn({ bookingId }, "Authorization email suppressed: no transport");
    return { result: "suppressed", reason };
  }

  const { id: signatureId, token, expiresAt } = await createSignatureRequest(
    bookingId,
    recipient,
    actorId,
  );

  const signUrl = `${origin.replace(/\/+$/, "")}/sign/${encodeURIComponent(token)}`;
  const rendered = renderBookingAuthorization(toAuthorizationData(booking), {
    signUrl,
    expiresAt,
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

    log.info({ bookingId, signatureId, actorId }, "Authorization email sent");

    return { result: "sent", signatureId, recipient, expiresAt };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown transport error";
    await record(NotificationStatus.FAILED, { lastError: reason });
    log.error({ err: error, bookingId }, "Authorization email failed");
    return { result: "failed", reason };
  }
}
