import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  BookingProduct,
  BookingStatus,
  CustomerStatus,
  PassengerType,
  TicketStatus,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { MissingEvidenceError } from "@/lib/bookings/status";
import { prisma } from "@/lib/db/prisma";
import { createFlightBooking } from "@/server/services/booking-service";
import { transitionBooking } from "@/server/services/booking-status-service";
import { flushPendingBookingEmails } from "@/server/services/customer-email-service";
import {
  TicketNotIssuableError,
  issueTicket,
} from "@/server/services/ticketing-service";

/**
 * Ticket issuing against the real database.
 *
 * The case that matters most is the last one: before this service existed a
 * booking could reach CONFIRMED and go no further, because the TICKETED
 * transition demands an issued ticket status and a ticket number that nothing
 * in the application could write. Issuing is what makes the lifecycle
 * completable, so that is asserted end to end rather than in parts.
 */

const SUFFIX = Date.now();
let actorId: string;
let customerId: string;
const bookingIds: string[] = [];

const AMOUNTS = {
  baseFareMinor: 90_000,
  taxesFeesMinor: 12_997,
  totalMinor: 102_997,
  supplierCostMinor: 92_697,
  grossMcoMinor: 102_997,
  netMcoMinor: 92_697,
};

async function makeFlight(
  options: {
    status?: BookingStatus;
    airlineConfirmation?: string | undefined;
    passengers?: number;
  } = {},
): Promise<string> {
  const {
    status = BookingStatus.CONFIRMED,
    airlineConfirmation = "ABC123",
    passengers = 1,
  } = options;

  const { id } = await createFlightBooking(
    {
      booking: {
        customerId,
        ticketStatus: TicketStatus.PENDING,
        mcoStatus: "NOT_APPLICABLE",
        currency: "USD",
        splitCharges: false,
        airlineConfirmation,
      } as never,
      amounts: AMOUNTS,
      passengers: Array.from({ length: passengers }, (_, index) => ({
        firstName: "Test",
        lastName: `Passenger${index}`,
        type: PassengerType.ADULT,
      })) as never,
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

  // Creation always opens a booking as Pending now — status is no longer an
  // input. Tests that need a later status set it directly, rather than going
  // through the transition service, which would demand the evidence these
  // fixtures exist to test.
  if (status !== BookingStatus.PENDING) {
    await prisma.booking.update({ where: { id }, data: { status } });
  }

  return id;
}

async function passengerIds(bookingId: string): Promise<string[]> {
  const rows = await prisma.passenger.findMany({
    where: { bookingId },
    select: { id: true },
    orderBy: { lastName: "asc" },
  });
  return rows.map((row) => row.id);
}

beforeAll(async () => {
  const actor = await prisma.adminUser.create({
    data: {
      email: `ticketing-test-${SUFFIX}@example.invalid`,
      name: "Ticketing Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  });
  actorId = actor.id;

  const customer = await prisma.customer.create({
    data: {
      reference: `CUS-TKT-${SUFFIX}`,
      firstName: "Ticketing",
      lastName: "Customer",
      email: `ticketing-customer-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
    },
    select: { id: true },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await flushPendingBookingEmails();
  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  await prisma.notification.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.adminUser.deleteMany({ where: { id: actorId } });
});

describe("issueTicket", () => {
  it("marks the ticket issued, stamps the time and stores the numbers", async () => {
    const bookingId = await makeFlight();
    const [passengerId] = await passengerIds(bookingId);

    const result = await issueTicket({
      bookingId,
      actorId,
      ticketNumbers: { [passengerId!]: "176-2451889301" },
      ticketingReference: "SUP-9",
    });

    expect(result.changed).toBe(true);
    expect(result.numbered).toBe(1);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        ticketStatus: true,
        ticketedAt: true,
        ticketingReference: true,
        passengers: { select: { ticketNumber: true } },
      },
    });

    expect(booking.ticketStatus).toBe(TicketStatus.ISSUED);
    expect(booking.ticketedAt).toBeInstanceOf(Date);
    expect(booking.ticketingReference).toBe("SUP-9");
    expect(booking.passengers[0]?.ticketNumber).toBe("176-2451889301");
  });

  it("writes an audit entry that does not contain the ticket number", async () => {
    const bookingId = await makeFlight();
    const [passengerId] = await passengerIds(bookingId);

    await issueTicket({
      bookingId,
      actorId,
      ticketNumbers: { [passengerId!]: "176-9999999999" },
    });

    const entries = await prisma.auditLog.findMany({
      where: { entityId: bookingId, adminUserId: actorId },
      select: { summary: true, changes: true },
    });

    expect(entries.length).toBeGreaterThan(0);

    // The number identifies a traveller's document and the audit log is widely
    // read, so it must not be carried into the trail.
    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain("176-9999999999");
  });

  it("is a no-op when the ticket was already issued", async () => {
    const bookingId = await makeFlight();
    const [passengerId] = await passengerIds(bookingId);

    await issueTicket({
      bookingId,
      actorId,
      ticketNumbers: { [passengerId!]: "176-1111111111" },
    });

    const first = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { ticketedAt: true },
    });

    const again = await issueTicket({
      bookingId,
      actorId,
      ticketNumbers: { [passengerId!]: "176-2222222222" },
    });

    expect(again.changed).toBe(false);

    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { ticketedAt: true, passengers: { select: { ticketNumber: true } } },
    });

    // Neither the issue time nor the number is overwritten by a resubmission.
    expect(after.ticketedAt?.getTime()).toBe(first.ticketedAt?.getTime());
    expect(after.passengers[0]?.ticketNumber).toBe("176-1111111111");
  });

  it("refuses a booking with no airline confirmation", async () => {
    const bookingId = await makeFlight();
    const [passengerId] = await passengerIds(bookingId);

    // Cleared directly: the creation path supplies a confirmation, and the
    // rule under test belongs to issuing, not to how the row came to exist.
    await prisma.booking.update({
      where: { id: bookingId },
      data: { airlineConfirmation: null },
    });

    await expect(
      issueTicket({
        bookingId,
        actorId,
        ticketNumbers: { [passengerId!]: "176-3333333333" },
      }),
    ).rejects.toThrow(TicketNotIssuableError);
  });

  it("refuses a cancelled booking", async () => {
    const bookingId = await makeFlight({ status: BookingStatus.PENDING });
    const [passengerId] = await passengerIds(bookingId);

    await transitionBooking({
      bookingId,
      toStatus: BookingStatus.CANCELLED,
      actorId,
      reason: "Customer withdrew",
    });

    await expect(
      issueTicket({
        bookingId,
        actorId,
        ticketNumbers: { [passengerId!]: "176-4444444444" },
      }),
    ).rejects.toThrow(TicketNotIssuableError);
  });

  it("refuses a cruise, which is confirmed rather than ticketed", async () => {
    const bookingId = await makeFlight();
    const [passengerId] = await passengerIds(bookingId);

    // Switched directly rather than built through createCruiseBooking: the
    // rule under test is that issuing reads the product and refuses a
    // non-flight, which does not depend on how the cruise was created.
    await prisma.booking.update({
      where: { id: bookingId },
      data: { product: BookingProduct.CRUISE },
    });

    await expect(
      issueTicket({
        bookingId,
        actorId,
        ticketNumbers: { [passengerId!]: "176-5555555555" },
      }),
    ).rejects.toThrow(TicketNotIssuableError);
  });

  it("refuses when no passenger has been given a number", async () => {
    const bookingId = await makeFlight();

    await expect(
      issueTicket({ bookingId, actorId, ticketNumbers: {} }),
    ).rejects.toThrow(TicketNotIssuableError);
  });

  it("ignores passenger ids belonging to another booking", async () => {
    const target = await makeFlight();
    const other = await makeFlight();

    const [otherPassengerId] = await passengerIds(other);

    // Only a foreign id is submitted, so nothing is numbered and the issue is
    // refused — rather than quietly writing onto the other booking's traveller.
    await expect(
      issueTicket({
        bookingId: target,
        actorId,
        ticketNumbers: { [otherPassengerId!]: "176-6666666666" },
      }),
    ).rejects.toThrow(TicketNotIssuableError);

    const untouched = await prisma.passenger.findUniqueOrThrow({
      where: { id: otherPassengerId! },
      select: { ticketNumber: true },
    });

    expect(untouched.ticketNumber).toBeNull();
  });

  it("unlocks the CONFIRMED to TICKETED transition", async () => {
    const bookingId = await makeFlight({ status: BookingStatus.CONFIRMED });
    const [passengerId] = await passengerIds(bookingId);

    // Before issuing, the evidence rules refuse the move.
    await expect(
      transitionBooking({
        bookingId,
        toStatus: BookingStatus.TICKETED,
        actorId,
      }),
    ).rejects.toThrow(MissingEvidenceError);

    await issueTicket({
      bookingId,
      actorId,
      ticketNumbers: { [passengerId!]: "176-7777777777" },
    });

    const moved = await transitionBooking({
      bookingId,
      toStatus: BookingStatus.TICKETED,
      actorId,
    });

    expect(moved.changed).toBe(true);
    expect(moved.toStatus).toBe(BookingStatus.TICKETED);
  });
});
