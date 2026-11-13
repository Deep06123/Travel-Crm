import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  BookingStatus,
  CustomerStatus,
  NotificationStatus,
  PassengerType,
  TicketStatus,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { resetEnvCache } from "@/lib/env";
import { resetMailerCache } from "@/lib/mail";
import {
  flushPendingAdminNotices,
  sendAdminNotice,
} from "@/server/services/admin-notification-service";
import { createFlightBooking } from "@/server/services/booking-service";
import { transitionBooking } from "@/server/services/booking-status-service";
import {
  BOOKING_CONFIRMED,
  BOOKING_TICKETED,
  flushPendingBookingEmails,
  getETicketPreview,
  previewBookingEmail,
  sendBookingEmail,
} from "@/server/services/customer-email-service";

import {
  restoreMailAccounts,
  suspendMailAccounts,
  type SuspendedAccounts,
} from "../helpers/mail-accounts";
import {
  restoreAdminNoticeSetting,
  setAdminNoticeEmails,
  takeAdminNoticeSetting,
  type SavedNoticeSetting,
} from "../helpers/admin-notices";
import { SmtpSink, decodeQuotedPrintable } from "../helpers/smtp-sink";

/**
 * Customer email on booking confirmation and ticketing.
 *
 * These run against a real SMTP server listening on loopback, so what is
 * asserted is the message that actually crossed a socket — not the arguments a
 * mocked transport was handed.
 */

const SUFFIX = Date.now();
const sink = new SmtpSink();

let actorId: string;
let customerId: string;
let savedNotices: SavedNoticeSetting = null;
let suspendedAccounts: SuspendedAccounts = [];
const bookingIds: string[] = [];

/** The whole decoded message, headers and body, as readable text. */
function readMessage(): string {
  const raw = sink.only().data;
  return decodeQuotedPrintable(raw);
}

async function makeBooking(
  overrides: {
    status?: BookingStatus;
    ticketStatus?: TicketStatus;
    airlineConfirmation?: string | undefined;
    ticketNumber?: string | undefined;
    contactEmail?: string | null;
  } = {},
): Promise<string> {
  const {
    status = BookingStatus.PENDING,
    ticketStatus = TicketStatus.PENDING,
    // CONFIRMED requires a confirmation reference as evidence, so the
    // fixture supplies one by default; these tests are about the email, not
    // about re-proving the evidence rules.
    airlineConfirmation = "ABC123",
    ticketNumber,
    contactEmail,
  } = overrides;

  const { id } = await createFlightBooking(
    {
      booking: {
        customerId,
        ticketStatus,
        mcoStatus: "NOT_APPLICABLE",
        currency: "USD",
        splitCharges: false,
        airlineConfirmation,
        ...(contactEmail === undefined ? {} : { contactEmail }),
      } as never,
      amounts: {
        baseFareMinor: 90_000,
        taxesFeesMinor: 12_997,
        totalMinor: 102_997,
        supplierCostMinor: 92_697,
        grossMcoMinor: 0,
        netMcoMinor: 0,
      },
      passengers: [
        {
          firstName: "Ada",
          lastName: "Lovelace",
          type: PassengerType.ADULT,
          ticketNumber,
          passportNumber: "X1234567",
        } as never,
      ],
      segments: [
        {
          airline: "Delta",
          flightNumber: "DL123",
          origin: "JFK",
          destination: "LHR",
          departureAt: new Date("2027-03-01T18:00:00Z"),
          arrivalAt: new Date("2027-03-02T06:00:00Z"),
        } as never,
      ],
    },
    actorId,
  );

  bookingIds.push(id);

  // Creation always opens a booking as Pending now. A fixture that needs a
  // later status sets it directly, rather than through the transition service
  // whose evidence rules are not what this file is testing.
  if (status !== BookingStatus.PENDING) {
    await prisma.booking.update({ where: { id }, data: { status } });
  }

  return id;
}

beforeAll(async () => {
  const port = await sink.start();

  // Configured before any module reads it; `resetMailerCache` clears the
  // adapter memoised from an earlier test file in the same process.
  process.env.MAIL_DRIVER = "smtp";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(port);
  process.env.SMTP_SECURE = "false";
  process.env.MAIL_FROM = "Travel CRM <bookings@example.invalid>";
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;

  // Both caches must be cleared, and in this order. Importing the service
  // graph has already parsed the environment (MAIL_DRIVER="none" from .env)
  // and may have memoised the resulting adapter; without the reset the suite
  // silently exercises the suppressed path and proves nothing.
  resetEnvCache();
  resetMailerCache();

  // Off for the file. An operator who has configured internal copies in the
  // development database would otherwise put a second message on the wire for
  // every send here, and every assertion about what was emailed is about the
  // customer's message.
  savedNotices = await takeAdminNoticeSetting();

  // And likewise any sending account configured in Settings: `resolveMailer`
  // prefers one over the SMTP_* variables set above, which would send this
  // file's assertions through somebody else's mailbox.
  suspendedAccounts = await suspendMailAccounts();

  const actor = await prisma.adminUser.create({
    data: {
      email: `mail-test-${SUFFIX}@example.invalid`,
      name: "Mail Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  });
  actorId = actor.id;

  const customer = await prisma.customer.create({
    data: {
      reference: `CUS-MAIL-${SUFFIX}`,
      firstName: "Grace",
      lastName: "Hopper",
      email: `mail-customer-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
    },
    select: { id: true },
  });
  customerId = customer.id;
});

afterEach(async () => {
  // A notice dispatched by the test that just ended is still in flight, and
  // would otherwise land in the next test's sink.
  await flushPendingAdminNotices();
  sink.reset();
});

afterAll(async () => {
  // A dispatch still in flight would otherwise write to rows this block is
  // deleting, and fail against a closed connection.
  await flushPendingBookingEmails();
  await restoreAdminNoticeSetting(savedNotices);
  await restoreMailAccounts(suspendedAccounts);
  await prisma.notification.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });
  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.adminUser.deleteMany({ where: { id: actorId } });
  await sink.stop();
  await prisma.$disconnect();
});

describe("confirming a booking", () => {
  it("emails the customer and records the send", async () => {
    const id = await makeBooking();

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    // The dispatch is deliberately asynchronous, so the assertions below
    // would otherwise race it.
    await flushPendingBookingEmails();

    expect(sink.messages).toHaveLength(1);

    const message = readMessage();
    expect(message).toContain(`mail-customer-${SUFFIX}@example.invalid`);
    expect(message).toContain("YOUR RESERVATION IS CONFIRMED!!");
    expect(message).toContain("$1,029.97");
    expect(message).toContain("JFK");
    expect(message).toContain("LHR");

    const notification = await prisma.notification.findFirstOrThrow({
      where: { bookingId: id, eventType: BOOKING_CONFIRMED },
    });
    expect(notification.status).toBe(NotificationStatus.SENT);
    expect(notification.sentAt).not.toBeNull();
    expect(notification.provider).toBe("smtp");
    expect(notification.providerReference).toBeTruthy();
  });

  it("prefers the booking's contact email over the customer profile", async () => {
    const id = await makeBooking({
      contactEmail: `booking-contact-${SUFFIX}@example.invalid`,
    });

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    // The dispatch is deliberately asynchronous, so the assertions below
    // would otherwise race it.
    await flushPendingBookingEmails();

    expect(sink.only().recipients).toEqual([
      `booking-contact-${SUFFIX}@example.invalid`,
    ]);
  });

  it("never puts a passport number in the message", async () => {
    const id = await makeBooking();

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    // The dispatch is deliberately asynchronous, so the assertions below
    // would otherwise race it.
    await flushPendingBookingEmails();

    // The passenger genuinely has this passport stored, so the absence below
    // is the redaction working rather than an empty field.
    const passenger = await prisma.passenger.findFirstOrThrow({
      where: { bookingId: id },
      select: { passportNumber: true },
    });
    expect(passenger.passportNumber).toBe("X1234567");

    expect(readMessage()).not.toContain("X1234567");
  });

  it("does not disclose supplier cost or margin", async () => {
    const id = await makeBooking();

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    // The dispatch is deliberately asynchronous, so the assertions below
    // would otherwise race it.
    await flushPendingBookingEmails();

    const message = readMessage();
    // 92,697 minor units is the supplier cost; the customer is told 1,029.97.
    expect(message).not.toContain("926.97");
    expect(message).toContain("$1,029.97");
  });

  it("re-applying the same status does not send a second email", async () => {
    const id = await makeBooking();

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    // The dispatch is deliberately asynchronous, so the assertions below
    // would otherwise race it.
    await flushPendingBookingEmails();
    expect(sink.messages).toHaveLength(1);

    const again = await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });
    await flushPendingBookingEmails();

    expect(again.changed).toBe(false);
    expect(sink.messages).toHaveLength(1);
  });

  it("refuses to send the same event twice even when called directly", async () => {
    const id = await makeBooking();

    const first = await sendBookingEmail({
      bookingId: id,
      event: BOOKING_CONFIRMED,
    });
    const second = await sendBookingEmail({
      bookingId: id,
      event: BOOKING_CONFIRMED,
    });

    expect(first.result).toBe("sent");
    expect(second.result).toBe("duplicate");
    expect(sink.messages).toHaveLength(1);
  });

  it("sends again when an operator explicitly forces a resend", async () => {
    const id = await makeBooking();

    await sendBookingEmail({ bookingId: id, event: BOOKING_CONFIRMED });
    const resent = await sendBookingEmail({
      bookingId: id,
      event: BOOKING_CONFIRMED,
      force: true,
    });

    expect(resent.result).toBe("sent");
    expect(sink.messages).toHaveLength(2);
  });
});

/**
 * An operator's wording, once sent, is the message for this booking.
 *
 * The same complaint as the authorization email: an edit went out, every
 * preview afterwards re-rendered the booking and showed the generated
 * document, and the next send quietly reverted to it.
 */
describe("an edited lifecycle email", () => {
  const EDIT = {
    subject: "Your documents, as discussed",
    body: "As agreed on the phone, here are the amended details.",
  };

  /**
   * An edit changes the subject and the opening message. It does not change
   * the document — the traveller table, the ticket numbers and the charges are
   * what the customer is being sent, and an edited send used to replace the
   * whole thing with a plain note, deleting the ticket from their email.
   */
  it("keeps the document and replaces only the opening", async () => {
    const id = await makeBooking({
      status: BookingStatus.TICKETED,
      ticketStatus: TicketStatus.ISSUED,
      airlineConfirmation: "ABC123",
      ticketNumber: "0062345678901",
    });

    const sent = await sendBookingEmail({
      bookingId: id,
      event: BOOKING_TICKETED,
      force: true,
      override: EDIT,
    });

    expect(sent).toMatchObject({ result: "sent", edited: true });

    const message = readMessage();
    expect(message).toContain(`Subject: ${EDIT.subject}`);
    expect(message).toContain(EDIT.body);
    // The document is intact.
    expect(message).toContain("YOUR E-TICKET IS ISSUED!!");
    expect(message).toContain("0062345678901");
    expect(message).toContain("Ada Lovelace");
    // And the generated opening is gone, rather than sitting above the edit.
    expect(message).not.toContain("Greetings for the day");
  });

  it("is what the preview and a later resend both use", async () => {
    const id = await makeBooking();

    await sendBookingEmail({
      bookingId: id,
      event: BOOKING_CONFIRMED,
      force: true,
      override: EDIT,
    });
    sink.reset();

    const preview = await previewBookingEmail(id, BOOKING_CONFIRMED);
    expect(preview.subject).toBe(EDIT.subject);
    expect(preview.body).toBe(EDIT.body);
    // The editable block is the opening message, not the whole document.
    expect(preview.generatedBody).toContain("Greetings for the day");
    expect(preview.generatedBody).not.toContain("Booking reference");

    // The plain Send button: forced, but carrying no override of its own.
    const resent = await sendBookingEmail({
      bookingId: id,
      event: BOOKING_CONFIRMED,
      force: true,
    });

    expect(resent).toMatchObject({ result: "sent", edited: true });
    expect(readMessage()).toContain(EDIT.body);
  });

  it("is what the e-ticket page shows, document and all", async () => {
    const id = await makeBooking({
      status: BookingStatus.TICKETED,
      ticketStatus: TicketStatus.ISSUED,
      airlineConfirmation: "ABC123",
      ticketNumber: "0062345678901",
    });

    const before = await getETicketPreview(id);
    expect(before?.html).toContain("E-TICKET IS ISSUED");
    expect(before?.html).toContain("Greetings for the day");

    await sendBookingEmail({
      bookingId: id,
      event: BOOKING_TICKETED,
      force: true,
      override: EDIT,
    });

    const after = await getETicketPreview(id);
    expect(after?.subject).toBe(EDIT.subject);
    expect(after?.html).toContain(EDIT.body);
    // Still the document, with the ticket numbers and the traveller table.
    expect(after?.html).toContain("E-TICKET IS ISSUED");
    expect(after?.html).toContain("0062345678901");
    expect(after?.html).not.toContain("Greetings for the day");
  });

  /**
   * The e-ticket page draws the document for the booking's own status, but its
   * Send button posts BOOKING_TICKETED whatever that status is. Looking the
   * stored wording up by status therefore wrote an edit under one event and
   * looked for it under another, and a booking still PENDING went on showing
   * the generated opening after an edited send.
   */
  it("is shown on the e-ticket page even before the booking is ticketed", async () => {
    const id = await makeBooking();

    await sendBookingEmail({
      bookingId: id,
      event: BOOKING_TICKETED,
      force: true,
      override: EDIT,
    });

    const preview = await getETicketPreview(id);

    expect(preview?.html).toContain(EDIT.body);
    expect(preview?.html).not.toContain("Greetings for the day");
    // The booking has no tickets yet, so the document is still the
    // confirmation — only the opening changed.
    expect(preview?.html).toContain("RESERVATION IS CONFIRMED");
  });

  it("is not disturbed by the status change that follows it", async () => {
    const id = await makeBooking({
      status: BookingStatus.CONFIRMED,
      ticketStatus: TicketStatus.ISSUED,
      airlineConfirmation: "ABC123",
      ticketNumber: "0062345678901",
    });

    await sendBookingEmail({
      bookingId: id,
      event: BOOKING_TICKETED,
      force: true,
      override: EDIT,
    });
    sink.reset();

    // A status change, with nobody at a keyboard. It is deduped — this event
    // has already been sent for this booking — so it neither re-sends the
    // operator's message nor replaces it with the generated one.
    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.TICKETED,
      actorId,
    });
    await flushPendingBookingEmails();

    expect(sink.messages).toHaveLength(0);
    expect((await getETicketPreview(id))?.html).toContain(EDIT.body);
  });

  /** The way back: restore the generated opening in the editor and send it. */
  it("stops being the message once the generated opening is sent", async () => {
    const id = await makeBooking({
      status: BookingStatus.TICKETED,
      ticketStatus: TicketStatus.ISSUED,
      airlineConfirmation: "ABC123",
      ticketNumber: "0062345678901",
    });

    await sendBookingEmail({
      bookingId: id,
      event: BOOKING_TICKETED,
      force: true,
      override: EDIT,
    });
    sink.reset();

    // "Use the generated message" in the editor, then send.
    const generated = (await previewBookingEmail(id, BOOKING_TICKETED))
      .generatedBody;

    await sendBookingEmail({
      bookingId: id,
      event: BOOKING_TICKETED,
      force: true,
      override: { subject: "Your e-ticket", body: generated },
    });

    const preview = await getETicketPreview(id);
    expect(preview?.html).toContain("Greetings for the day");
    expect(preview?.html).not.toContain(EDIT.body);
  });
});

describe("ticketing a booking", () => {
  it("emails the ticket numbers once the booking is TICKETED", async () => {
    const id = await makeBooking({
      status: BookingStatus.CONFIRMED,
      ticketStatus: TicketStatus.ISSUED,
      airlineConfirmation: "ABC123",
      ticketNumber: "0062345678901",
    });

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.TICKETED,
      actorId,
    });

    // The dispatch is deliberately asynchronous, so the assertions below
    // would otherwise race it.
    await flushPendingBookingEmails();

    const message = readMessage();
    expect(message).toContain("YOUR E-TICKET IS ISSUED!!");
    expect(message).toContain("0062345678901");
    expect(message).toContain("Ada Lovelace");
    expect(message).toContain("ABC123");

    const notification = await prisma.notification.findFirstOrThrow({
      where: { bookingId: id, eventType: BOOKING_TICKETED },
    });
    expect(notification.status).toBe(NotificationStatus.SENT);
  });
});

describe("when the email cannot be sent", () => {
  it("records FAILED and leaves the status change standing", async () => {
    const id = await makeBooking();
    sink.rejectRecipients = true;

    const result = await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });
    await flushPendingBookingEmails();

    // The operator's action succeeded; only the email did not.
    expect(result.toStatus).toBe(BookingStatus.CONFIRMED);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(booking.status).toBe(BookingStatus.CONFIRMED);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { bookingId: id, eventType: BOOKING_CONFIRMED },
    });
    expect(notification.status).toBe(NotificationStatus.FAILED);
    expect(notification.lastError).toBeTruthy();
    expect(notification.sentAt).toBeNull();
    expect(notification.attemptCount).toBeGreaterThan(0);
  });

  it("suppresses rather than fails when there is no address to send to", async () => {
    const orphan = await prisma.customer.create({
      data: {
        reference: `CUS-NOMAIL-${SUFFIX}`,
        firstName: "No",
        lastName: "Email",
        status: CustomerStatus.ACTIVE,
      },
      select: { id: true },
    });

    const previousCustomer = customerId;
    customerId = orphan.id;
    const id = await makeBooking({ contactEmail: null });
    customerId = previousCustomer;

    const outcome = await sendBookingEmail({
      bookingId: id,
      event: BOOKING_CONFIRMED,
    });

    expect(outcome.result).toBe("suppressed");
    expect(sink.messages).toHaveLength(0);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { bookingId: id, eventType: BOOKING_CONFIRMED },
    });
    expect(notification.status).toBe(NotificationStatus.SUPPRESSED);

    await prisma.notification.deleteMany({ where: { bookingId: id } });
    await prisma.booking.deleteMany({ where: { id } });
    bookingIds.splice(bookingIds.indexOf(id), 1);
    await prisma.customer.delete({ where: { id: orphan.id } });
  });
});

describe("internal notifications", () => {
  const OFFICE = "ops@example.invalid";

  it("copies the office when a confirmation reaches the customer", async () => {
    await setAdminNoticeEmails([OFFICE]);
    const id = await makeBooking();

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    await flushPendingBookingEmails();
    await flushPendingAdminNotices();

    const notice = sink.messages.find((message) =>
      message.recipients.includes(OFFICE),
    );

    expect(notice).toBeDefined();

    const body = decodeQuotedPrintable(notice!.data);
    expect(body).toContain("Booking confirmation sent to the customer");
    expect(body).toContain(`mail-customer-${SUFFIX}@example.invalid`);
    // A notice, not a second copy of the customer's document.
    expect(body).not.toContain("YOUR RESERVATION IS CONFIRMED!!");

    const row = await prisma.notification.findFirst({
      where: { bookingId: id, eventType: "ADMIN_CUSTOMER_EMAIL_SENT" },
      select: { status: true, recipient: true },
    });

    expect(row?.status).toBe(NotificationStatus.SENT);
    expect(row?.recipient).toBe(OFFICE);

    await setAdminNoticeEmails([]);
  });

  it("names the e-ticket rather than the confirmation when that is what went", async () => {
    await setAdminNoticeEmails([OFFICE]);
    const id = await makeBooking({
      status: BookingStatus.CONFIRMED,
      ticketStatus: TicketStatus.ISSUED,
      airlineConfirmation: "ABC123",
      ticketNumber: "0062345678901",
    });

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.TICKETED,
      actorId,
    });

    await flushPendingBookingEmails();
    await flushPendingAdminNotices();

    const notice = sink.messages.find((message) =>
      message.recipients.includes(OFFICE),
    );

    const body = decodeQuotedPrintable(notice!.data);
    expect(body).toContain("E-ticket sent to the customer");
    expect(body).not.toContain("Booking confirmation sent");
    // The ticket number is the customer's document, not the office's notice.
    expect(body).not.toContain("0062345678901");

    await setAdminNoticeEmails([]);
  });

  it("records FAILED when the transport rejects the notice", async () => {
    await setAdminNoticeEmails([OFFICE]);
    const id = await makeBooking();

    sink.rejectRecipients = true;

    // Called directly rather than through a customer send: the two share one
    // sink, and the case worth proving is a notice that fails on its own.
    const outcome = await sendAdminNotice({
      bookingId: id,
      bookingNumber: "BK-TEST",
      event: "ADMIN_CUSTOMER_EMAIL_SENT",
      headline: "Booking confirmation sent to the customer",
      rows: [{ label: "Sent to", value: "someone@example.invalid" }],
    });

    expect(outcome.result).toBe("failed");

    const row = await prisma.notification.findFirstOrThrow({
      where: { bookingId: id, eventType: "ADMIN_CUSTOMER_EMAIL_SENT" },
    });

    // The row says what happened: attempted, rejected, never sent.
    expect(row.status).toBe(NotificationStatus.FAILED);
    expect(row.lastError).toBeTruthy();
    expect(row.sentAt).toBeNull();
    expect(row.attemptCount).toBeGreaterThan(0);

    await setAdminNoticeEmails([]);
  });
});
