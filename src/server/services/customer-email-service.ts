import "server-only";

import { after } from "next/server";

import {
  BookingProduct,
  BookingStatus,
  NotificationChannel,
  NotificationStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { renderETicket } from "@/lib/mail/eticket";
import {
  bookingRecipientLine,
  bookingRecipients,
} from "@/lib/bookings/recipients";
import { prisma } from "@/lib/db/prisma";
import { withUpsertRetry } from "@/lib/db/upsert-retry";
import { loggerFor } from "@/lib/logging/logger";
import { getMailer } from "@/lib/mail";
import {
  prepareItineraryForEmail,
  prepareItineraryForPreview,
} from "@/lib/mail/inline-itinerary";
import {
  renderBookingConfirmed,
  renderBookingTicketed,
  renderEditedEmail,
  type BookingEmailData,
} from "@/lib/mail/templates";
import type { PolicyOverrides } from "@/lib/mail/policies";

import { loadPolicyOverrides } from "./email-policy-service";

const log = loggerFor("customer-email");

/**
 * Customer-facing email for booking lifecycle events.
 *
 * Two rules shape this module.
 *
 * First, an email must never be able to fail a booking. Confirming a booking is
 * the operator's work and it is already committed by the time anything here
 * runs; an SMTP timeout cannot be allowed to roll that back or surface as an
 * error on the status control. Every entry point therefore resolves rather
 * than throws, and reports the outcome instead.
 *
 * Second, the Notification row must say what actually happened. SENT means the
 * provider accepted the message. It is never written because a row was created,
 * a template rendered, or a transport looked configured.
 */

export const BOOKING_CONFIRMED = "BOOKING_CONFIRMED";
export const BOOKING_TICKETED = "BOOKING_TICKETED";

export type BookingEmailEvent =
  | typeof BOOKING_CONFIRMED
  | typeof BOOKING_TICKETED;

export type EmailOutcome =
  /** Accepted by the provider. */
  | { result: "sent"; notificationId: string }
  /** Already handled for this booking and event; nothing was sent again. */
  | { result: "duplicate"; notificationId: string }
  /** Nothing was attempted — no transport, or nowhere to send it. */
  | { result: "suppressed"; notificationId: string; reason: string }
  /** A send was attempted and the provider rejected it. */
  | { result: "failed"; notificationId: string; reason: string };

const TEMPLATES = {
  [BOOKING_CONFIRMED]: "booking-confirmed",
  [BOOKING_TICKETED]: "booking-ticketed",
} as const;

/** Stable identity for one event on one booking, backing the unique index. */
function dedupeKeyFor(bookingId: string, event: BookingEmailEvent): string {
  return `booking:${bookingId}:${event}`;
}

const BOOKING_SELECT = {
  id: true,
  bookingNumber: true,
  product: true,
  currency: true,
  totalMinor: true,
  travelStartDate: true,
  airlineConfirmation: true,
  customEmailSubject: true,
  emailTopHeading: true,
  contactName: true,
  contactEmail: true,
  billingEmails: true,
  // The cardholder name and last four digits, which is all of the card the
  // database holds. No PAN and no CVV column exists to select.
  cardHolderName: true,
  cardType: true,
  cardLast4: true,
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
      itineraryHtml: true,
    },
  },
  // Only the itinerary. The rest of the flight detail — the raw PNR, the
  // locator — is working material for staff and has no place in a customer's
  // inbox.
  flightDetail: { select: { itineraryHtml: true } },
  // Passport numbers are deliberately not selected: nothing in a customer
  // email may carry one, and the safest way to guarantee that is for the data
  // never to be loaded.
  passengers: {
    // By the sequence captured on the booking form, so the traveller table on
    // the e-ticket is numbered the way the agent entered it.
    orderBy: { sequence: "asc" },
    select: {
      firstName: true,
      lastName: true,
      ticketNumber: true,
      gender: true,
      dateOfBirth: true,
    },
  },
  // The support number printed in the e-ticket header.
  tfn: { select: { number: true } },
} as const;

export interface SendBookingEmailInput {
  bookingId: string;
  event: BookingEmailEvent;
  /**
   * Re-send even though this booking and event were handled before. Used by
   * the operator-triggered resend, and by a retry after a transport was fixed.
   */
  force?: boolean;
  /**
   * An operator-edited subject and body to send instead of the generated ones.
   *
   * Only ever set from the preview-and-edit control on the booking page, and
   * only alongside `force`. The automatic sends that follow a status change
   * never carry this — they must stay reproducible, so a confirmation reads
   * the same whoever happened to trigger it.
   *
   * `body` is plain text. See `renderEditedEmail` for why it is not HTML.
   */
  override?: { subject: string; body: string } | undefined;
}

/** Subject and body as they would be sent, without sending or recording. */
export interface EmailPreview {
  /** Empty when the booking has no contact address — nothing could be sent. */
  recipient: string;
  subject: string;
  body: string;
}

/**
 * Renders what an email would say, for review before it goes out.
 *
 * Writes nothing and sends nothing: an operator checking the wording must not
 * leave a notification record implying the customer heard from us. The output
 * is the editable starting point for a corrected send.
 */
export async function previewBookingEmail(
  bookingId: string,
  event: BookingEmailEvent,
): Promise<EmailPreview> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: BOOKING_SELECT,
  });

  if (!booking) {
    throw new Error(`Booking ${bookingId} does not exist.`);
  }

  // Only the text part is returned, but the itinerary is still prepared
  // rather than read raw: `htmlToPlainText` names an image it cannot flatten,
  // and that count should match the images the sent message will carry.
  const data: BookingEmailData = {
    ...toEmailData(booking, await loadPolicyOverrides()),
    itineraryHtml: await prepareItineraryForPreview(storedItinerary(booking)),
  };

  const rendered =
    event === BOOKING_CONFIRMED
      ? renderBookingConfirmed(data)
      : renderBookingTicketed(data);

  return {
    recipient: bookingRecipientLine(booking),
    subject: rendered.subject,
    body: rendered.text,
  };
}

/** The e-ticket document and who it would reach. */
export interface ETicketPreview {
  recipient: string;
  subject: string;
  html: string;
}

/**
 * Renders the e-ticket exactly as the customer would receive it.
 *
 * Writes nothing and sends nothing, for the same reason `previewBookingEmail`
 * does not: someone checking a document must not leave a notification record
 * implying the customer heard from us.
 *
 * Which event it renders follows the booking's own status rather than being
 * chosen by the caller — a booking that has not been ticketed has no e-ticket
 * to show, and offering one would be a drawing of a document that does not
 * exist.
 */
export async function getETicketPreview(
  bookingId: string,
  options: { redactDateOfBirth?: boolean } = {},
): Promise<ETicketPreview | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { ...BOOKING_SELECT, status: true },
  });

  if (!booking) return null;

  // Images inlined as data URIs: the preview renders in a `sandbox=""` iframe,
  // an opaque origin that sends no cookies and cannot resolve the stored
  // relative path, so the image would be broken here for the same reason it
  // would be in a mailbox.
  const data: BookingEmailData = {
    ...toEmailData(booking, await loadPolicyOverrides()),
    itineraryHtml: await prepareItineraryForPreview(storedItinerary(booking)),
  };

  const issued =
    booking.status === BookingStatus.TICKETED ||
    booking.status === BookingStatus.COMPLETED;

  const rendered = issued
    ? renderBookingTicketed(data)
    : renderBookingConfirmed(data);

  // Re-rendered with the redaction flag. The template's own HTML always shows
  // the date of birth, which is right for the customer and wrong for a role
  // that may not see it.
  const html = renderETicket(
    data,
    issued
      ? data.product === "CRUISE"
        ? "YOUR CRUISE DOCUMENTS ARE ISSUED!!"
        : "YOUR E-TICKET IS ISSUED!!"
      : "YOUR RESERVATION IS CONFIRMED!!",
    issued
      ? "Carry photo identification matching the name on the ticket."
      : "Thank you for booking with us.",
    { redactDateOfBirth: options.redactDateOfBirth ?? false },
  );

  return {
    recipient: bookingRecipientLine(booking),
    subject: rendered.subject,
    html,
  };
}

export async function sendBookingEmail({
  bookingId,
  event,
  override,
  force = false,
}: SendBookingEmailInput): Promise<EmailOutcome> {
  const dedupeKey = dedupeKeyFor(bookingId, event);
  const template = TEMPLATES[event];

  const existing = await prisma.notification.findUnique({
    where: { dedupeKey },
    select: { id: true, status: true },
  });

  // A previously accepted send is never repeated silently. Only an explicit
  // resend may put a second copy of the same message in a customer's inbox.
  if (existing && existing.status === NotificationStatus.SENT && !force) {
    return { result: "duplicate", notificationId: existing.id };
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: BOOKING_SELECT,
  });

  if (!booking) {
    // Not an email problem: the caller asked about a booking that is gone.
    throw new Error(`Booking ${bookingId} does not exist.`);
  }

  const recipients = bookingRecipients(booking);
  const recipient = recipients.length > 0 ? recipients.join(", ") : null;

  const upsert = async (
    data: {
      status: NotificationStatus;
      lastError?: string | null;
      sentAt?: Date | null;
      provider?: string | null;
      providerReference?: string | null;
    },
    incrementAttempt: boolean,
  ) =>
    // Retried on conflict. Prisma's upsert is a SELECT then an INSERT, and the
    // INSERT's foreign-key check fails with MySQL 1020 when the booking row it
    // points at is being updated by a transaction that was open at the time of
    // the SELECT — which is exactly what happens when two status transitions
    // follow one another and the first one's email is still in flight.
    withUpsertRetry("notification.upsert", () =>
      prisma.notification.upsert({
        where: { dedupeKey },
        create: {
          dedupeKey,
          bookingId,
          eventType: event,
          channel: NotificationChannel.EMAIL,
          template,
          recipient: recipient ?? "",
          attemptCount: incrementAttempt ? 1 : 0,
          // `edited` records that a person rewrote this rather than it being
          // the generated wording, which matters when someone later asks what
          // the customer was actually told.
          payload: {
            bookingNumber: booking.bookingNumber,
            ...(override ? { edited: true } : {}),
          },
          ...data,
        },
        update: {
          ...data,
          ...(incrementAttempt ? { attemptCount: { increment: 1 } } : {}),
        },
        select: { id: true },
      }),
    );

  if (!recipient) {
    const reason =
      "No contact email on the booking or the customer record, so there is nowhere to send it.";
    const row = await upsert(
      { status: NotificationStatus.SUPPRESSED, lastError: reason },
      false,
    );
    log.warn({ bookingId, event }, "Customer email suppressed: no recipient");
    return { result: "suppressed", notificationId: row.id, reason };
  }

  const mailer = getMailer();

  if (!mailer) {
    const reason =
      'No mail transport is configured (MAIL_DRIVER="none"), so no email was attempted.';
    const row = await upsert(
      { status: NotificationStatus.SUPPRESSED, lastError: reason },
      false,
    );
    log.warn(
      { bookingId, event },
      "Customer email suppressed: no transport configured",
    );
    return { result: "suppressed", notificationId: row.id, reason };
  }

  // An operator-edited version replaces the generated one wholesale. The
  // booking data is still read above, because the recipient and the
  // suppression checks come from it either way.
  //
  // An edited message carries no itinerary and so needs no attachments: the
  // operator wrote the whole body, and attaching images nothing in it refers
  // to would put unexplained files in the customer's inbox.
  const itinerary = override
    ? { html: null, attachments: [] }
    : await prepareItineraryForEmail(storedItinerary(booking));

  const data: BookingEmailData = {
    ...toEmailData(booking, await loadPolicyOverrides()),
    itineraryHtml: itinerary.html,
  };

  const rendered = override
    ? renderEditedEmail(override.subject, override.body)
    : event === BOOKING_CONFIRMED
      ? renderBookingConfirmed(data)
      : renderBookingTicketed(data);

  // The row is written *before* the send, with attemptCount incremented. A
  // process that dies mid-send then leaves PENDING with attemptCount > 0 —
  // visibly "we tried and never heard back" — rather than no trace at all.
  const row = await upsert({ status: NotificationStatus.PENDING }, true);

  try {
    const { providerReference } = await mailer.send({
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      attachments: itinerary.attachments,
    });

    await prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        provider: mailer.provider,
        providerReference: providerReference ?? null,
        lastError: null,
      },
    });

    log.info(
      { bookingId, event, notificationId: row.id, providerReference },
      "Customer email sent",
    );

    return { result: "sent", notificationId: row.id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    await prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.FAILED,
        provider: mailer.provider,
        lastError: reason.slice(0, 1_000),
      },
    });

    // Logged at error level but returned, not rethrown: the caller is a booking
    // transition that has already succeeded.
    log.error({ err: error, bookingId, event }, "Customer email failed");

    return { result: "failed", notificationId: row.id, reason };
  }
}

/** Derived from the select above, so adding a field cannot desync the two. */
type BookingRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>;

/**
 * The itinerary as stored, before its images have been relocated.
 *
 * Never rendered directly: every `src` in it points at an administrator-only
 * route. Callers pass it through `prepareItineraryForEmail` (or the preview
 * equivalent) and set the result on the data, which is why `toEmailData` below
 * leaves `itineraryHtml` unset rather than filling it in with this.
 */
function storedItinerary(booking: BookingRow): string | null {
  return booking.product === BookingProduct.CRUISE
    ? (booking.cruiseDetail?.itineraryHtml ?? null)
    : (booking.flightDetail?.itineraryHtml ?? null);
}

function toEmailData(
  booking: BookingRow,
  policyOverrides: PolicyOverrides,
): BookingEmailData {
  const customerName =
    booking.contactName?.trim() ||
    `${booking.customer.firstName} ${booking.customer.lastName}`.trim() ||
    "traveller";

  return {
    bookingNumber: booking.bookingNumber,
    customerName,
    product:
      booking.product === BookingProduct.CRUISE ? "CRUISE" : "FLIGHT",
    currency: booking.currency,
    totalMinor: booking.totalMinor,
    travelStartDate: booking.travelStartDate,
    airlineConfirmation: booking.airlineConfirmation,
    segments: booking.segments,
    cruise: booking.cruiseDetail,
    passengers: booking.passengers,
    cardHolderName: booking.cardHolderName,
    cardType: booking.cardType,
    cardLast4: booking.cardLast4,
    customEmailSubject: booking.customEmailSubject,
    emailTopHeading: booking.emailTopHeading,
    supportPhone: booking.tfn?.number ?? null,
    policyOverrides,
  };
}

/**
 * Fires a lifecycle email without ever propagating a failure, and without
 * making the operator wait for an SMTP round trip.
 *
 * `transitionBooking` calls this after its transaction commits. The status
 * change is done and recorded; whether an email left the building is a
 * separate fact, tracked on the Notification row.
 *
 * `after()` is what keeps this honest. A bare floating promise would race the
 * response: the server is free to finish the request and, on a platform that
 * freezes the process between invocations, the send would be abandoned
 * half-way with the row still reading SENDING. `after()` hands the work to the
 * runtime to finish after the response is flushed.
 */
export function dispatchBookingEmail(input: SendBookingEmailInput): void {
  const run = () => {
    const promise = sendBookingEmail(input)
      .catch((error: unknown) => {
        log.error(
          { err: error, bookingId: input.bookingId, event: input.event },
          "Customer email dispatch threw unexpectedly",
        );
      })
      .finally(() => inFlight.delete(promise));

    inFlight.add(promise);
    return promise;
  };

  try {
    after(run);
  } catch {
    // `after()` requires a request scope. Seeds, scripts and integration tests
    // call transitionBooking outside one, where there is no response to race.
    void run();
  }
}

/**
 * Sends dispatched in the background, for callers that must not race them.
 *
 * Tests await this rather than sleeping: a dispatch is asynchronous by design,
 * so asserting straight after a transition is a race the test would sometimes
 * win and sometimes lose. It is also the hook a graceful shutdown would use.
 */
const inFlight = new Set<Promise<unknown>>();

export async function flushPendingBookingEmails(): Promise<void> {
  // Re-read the set each pass: one send finishing can enqueue another.
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}

/** Notifications raised for a booking, newest first. */
export function getBookingNotifications(bookingId: string) {
  return prisma.notification.findMany({
    where: { bookingId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      eventType: true,
      channel: true,
      status: true,
      recipient: true,
      sentAt: true,
      attemptCount: true,
      lastError: true,
      createdAt: true,
    },
  });
}
