import "server-only";

import { after } from "next/server";

import {
  BookingStatus,
  NotificationChannel,
  NotificationStatus,
} from "@/generated/prisma/enums";
import { renderETicket } from "@/lib/mail/eticket";
import {
  bookingRecipientLine,
  bookingRecipients,
} from "@/lib/bookings/recipients";
import { prisma } from "@/lib/db/prisma";
import { withUpsertRetry } from "@/lib/db/upsert-retry";
import { loggerFor } from "@/lib/logging/logger";
import {
  prepareItineraryForEmail,
  prepareItineraryForPreview,
} from "@/lib/mail/inline-itinerary";
import { defaultETicketIntro } from "@/lib/mail/eticket";
import {
  renderBookingConfirmed,
  renderBookingTicketed,
  type BookingEmailData,
} from "@/lib/mail/templates";
import { formatMoney } from "@/lib/financial/money";

import {
  ADMIN_CUSTOMER_EMAIL_SENT,
  dispatchAdminNotice,
} from "./admin-notification-service";

import {
  AUTHORIZATION_SELECT,
  customerNameOf,
  storedItinerary,
  toAuthorizationData,
} from "./authorization-data";

import { loadPolicyOverrides } from "./email-policy-service";

import { resolveMailer } from "./mail-account-service";

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
  | {
      result: "sent";
      notificationId: string;
      /**
       * Whether what went out was an operator's wording rather than the
       * template — including a repeat of an earlier edit, which the caller
       * cannot tell from its own form fields.
       */
      edited: boolean;
    }
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

/**
 * The wording this event last went out with, where an operator wrote it.
 *
 * One row per booking per event, so this is simply "the message in the
 * customer's inbox". Only a row the provider accepted counts: a suppressed or
 * failed attempt delivered nothing, and showing its wording in a preview would
 * describe an email nobody received.
 */
async function lastSentWording(
  bookingId: string,
  event: BookingEmailEvent,
): Promise<EmailOverride | undefined> {
  const row = await prisma.notification.findUnique({
    where: { dedupeKey: dedupeKeyFor(bookingId, event) },
    select: { status: true, emailSubject: true, emailBody: true },
  });

  if (!row || row.status !== NotificationStatus.SENT) return undefined;
  if (!row.emailSubject || !row.emailBody) return undefined;

  return { subject: row.emailSubject, body: row.emailBody };
}

/** An operator's wording, in place of the generated message. */
export interface EmailOverride {
  subject: string;
  body: string;
}

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
   * `body` is plain text and replaces only the opening message — see
   * `defaultETicketIntro`. The document below it is generated from the booking
   * and is not editable.
   */
  override?: EmailOverride | undefined;
  /**
   * The sending identity the operator picked, where they picked one.
   *
   * Absent on every automatic send, which is correct: those are triggered by a
   * status change with nobody at a keyboard, so they take the default for the
   * kind of message. See `resolveMailer`.
   */
  mailAccountId?: string | undefined;
}

/** Subject and body as they would be sent, without sending or recording. */
export interface EmailPreview {
  /** Empty when the booking has no contact address — nothing could be sent. */
  recipient: string;
  subject: string;
  body: string;
  /**
   * The generated wording, whether or not `body` holds it.
   *
   * An edited send is remembered and reused, so the editor opens on the last
   * message an operator wrote. Without the template travelling beside it there
   * would be no way back to the standard wording.
   */
  generatedBody: string;
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
    select: AUTHORIZATION_SELECT,
  });

  if (!booking) {
    throw new Error(`Booking ${bookingId} does not exist.`);
  }

  // Only the text part is returned, but the itinerary is still prepared
  // rather than read raw: `htmlToPlainText` names an image it cannot flatten,
  // and that count should match the images the sent message will carry.
  const data: BookingEmailData = {
    ...toAuthorizationData(booking, await loadPolicyOverrides()),
    itineraryHtml: await prepareItineraryForPreview(storedItinerary(booking)),
  };

  const rendered =
    event === BOOKING_CONFIRMED
      ? renderBookingConfirmed(data)
      : renderBookingTicketed(data);

  // The message as it would be sent *now*: after an edited send that is the
  // edited one, which is what the next send repeats and what the customer is
  // holding.
  const sent = await lastSentWording(bookingId, event);

  // The opening block, not the whole message. Only that and the subject are
  // editable — the traveller table, the ticket numbers and the charges below
  // it are the document, and they are generated from the booking.
  const generated = defaultETicketIntro(data);

  return {
    recipient: bookingRecipientLine(booking),
    subject: sent?.subject ?? rendered.subject,
    body: sent?.body ?? generated,
    generatedBody: generated,
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
    select: { ...AUTHORIZATION_SELECT, status: true },
  });

  if (!booking) return null;

  // Images inlined as data URIs: the preview renders in a `sandbox=""` iframe,
  // an opaque origin that sends no cookies and cannot resolve the stored
  // relative path, so the image would be broken here for the same reason it
  // would be in a mailbox.
  const data: BookingEmailData = {
    ...toAuthorizationData(booking, await loadPolicyOverrides()),
    itineraryHtml: await prepareItineraryForPreview(storedItinerary(booking)),
  };

  const issued =
    booking.status === BookingStatus.TICKETED ||
    booking.status === BookingStatus.COMPLETED;

  // The opening message an operator sent, where they wrote one. Always the
  // ticketed event, deliberately not `issued`'s choice below: the Send button
  // on this page posts `BOOKING_TICKETED` whatever the booking's status is, so
  // that is the message this page is about. Keying it off the status instead
  // meant an edit sent from a booking still PENDING was stored under one event
  // and looked for under another, and the page went on showing the generated
  // opening while the customer held the edit.
  const sent = await lastSentWording(bookingId, BOOKING_TICKETED);
  const wording = sent ?? {};

  const rendered = issued
    ? renderBookingTicketed(data, wording)
    : renderBookingConfirmed(data, wording);

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
    {
      redactDateOfBirth: options.redactDateOfBirth ?? false,
      ...(sent ? { intro: sent.body } : {}),
    },
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
  mailAccountId,
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
    select: AUTHORIZATION_SELECT,
  });

  if (!booking) {
    // Not an email problem: the caller asked about a booking that is gone.
    throw new Error(`Booking ${bookingId} does not exist.`);
  }

  const recipients = bookingRecipients(booking);
  const recipient = recipients.length > 0 ? recipients.join(", ") : null;

  /**
   * What this send will actually say.
   *
   * An edit in hand wins; otherwise an operator-initiated send repeats the
   * wording the customer already has, so the Send button agrees with the
   * preview beside it rather than quietly reverting to the template.
   *
   * `force` is what distinguishes the two callers. An automatic send follows a
   * status change with nobody at a keyboard and must stay reproducible, so it
   * always renders the generated message.
   *
   * Belt and braces, as it happens: stored wording only exists on a row that
   * was already SENT, and an unforced send of an event already SENT is turned
   * away as a duplicate well before this. The condition is here so that
   * stays true by construction rather than by two rules happening to agree.
   */
  const wording =
    override ?? (force ? await lastSentWording(bookingId, event) : undefined);

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
            ...(wording ? { edited: true } : {}),
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

  // An e-ticket and a confirmation are different documents to a customer and
  // may legitimately come from different mailboxes, so the purpose follows the
  // event rather than being one "customer email" bucket.
  const mailer = await resolveMailer(
    event === BOOKING_TICKETED ? "eticket" : "confirmation",
    mailAccountId,
  );

  if (!mailer) {
    const reason =
      "No sending account is configured, so no email was attempted. Add one under Settings → Sending accounts.";
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

  // Prepared whether or not an operator edited anything. An edit replaces the
  // opening message and the subject, never the document — so the itinerary and
  // its images belong in the message exactly as they would otherwise.
  const itinerary = await prepareItineraryForEmail(storedItinerary(booking));

  const data: BookingEmailData = {
    ...toAuthorizationData(booking, await loadPolicyOverrides()),
    itineraryHtml: itinerary.html,
  };

  const rendered =
    event === BOOKING_CONFIRMED
      ? renderBookingConfirmed(data, wording ?? {})
      : renderBookingTicketed(data, wording ?? {});

  // The row is written *before* the send, with attemptCount incremented. A
  // process that dies mid-send then leaves PENDING with attemptCount > 0 —
  // visibly "we tried and never heard back" — rather than no trace at all.
  const row = await upsert({ status: NotificationStatus.PENDING }, true);

  try {
    const { providerReference } = await mailer.adapter.send({
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
        provider: mailer.adapter.provider,
        mailAccountId: mailer.accountId,
        providerReference: providerReference ?? null,
        lastError: null,
        // Written here rather than with the PENDING row, so the column pair
        // only ever describes a message the provider accepted. Written on
        // every success including the generated ones, which is what clears an
        // earlier edit: a booking sent the standard document must not keep
        // showing last month's custom wording in its preview.
        emailSubject: wording?.subject ?? null,
        emailBody: wording?.body ?? null,
      },
    });

    log.info(
      { bookingId, event, notificationId: row.id, providerReference },
      "Customer email sent",
    );

    // The office's copy of what the customer just received. Dispatched, never
    // awaited: this path already runs behind `after()` for an automatic send
    // and in front of an operator for a manual one, and neither may be failed
    // by an internal notice.
    dispatchAdminNotice({
      bookingId,
      bookingNumber: booking.bookingNumber,
      event: ADMIN_CUSTOMER_EMAIL_SENT,
      headline:
        event === BOOKING_CONFIRMED
          ? "Booking confirmation sent to the customer"
          : "E-ticket sent to the customer",
      rows: [
        { label: "Customer", value: customerNameOf(booking) },
        { label: "Sent to", value: recipient },
        { label: "Sent from", value: mailer.label },
        { label: "Subject", value: rendered.subject },
        {
          label: "Amount",
          value: formatMoney(booking.totalMinor, booking.currency),
        },
        { label: "Edited before sending", value: wording ? "Yes" : null },
      ],
    });

    return { result: "sent", notificationId: row.id, edited: Boolean(wording) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    await prisma.notification.update({
      where: { id: row.id },
      data: {
        status: NotificationStatus.FAILED,
        provider: mailer.adapter.provider,
        mailAccountId: mailer.accountId,
        lastError: reason.slice(0, 1_000),
      },
    });

    // Logged at error level but returned, not rethrown: the caller is a booking
    // transition that has already succeeded.
    log.error({ err: error, bookingId, event }, "Customer email failed");

    return { result: "failed", notificationId: row.id, reason };
  }
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
