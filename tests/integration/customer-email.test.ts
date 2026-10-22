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
import { createFlightBooking } from "@/server/services/booking-service";
import { transitionBooking } from "@/server/services/booking-status-service";
import {
  BOOKING_CONFIRMED,
  BOOKING_TICKETED,
  flushPendingBookingEmails,
  sendBookingEmail,
} from "@/server/services/customer-email-service";

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
        status,
        priority: "NORMAL",
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

afterEach(() => {
  sink.reset();
});

afterAll(async () => {
  // A dispatch still in flight would otherwise write to rows this block is
  // deleting, and fail against a closed connection.
  await flushPendingBookingEmails();
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
    expect(message).toContain("Booking confirmed");
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
    expect(message).toContain("Tickets issued");
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
