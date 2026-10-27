import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  BookingPriority,
  BookingStatus,
  ChargeOutcome,
  CustomerStatus,
  PassengerType,
  TicketStatus,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import {
  InvalidTransitionError,
  MissingEvidenceError,
  ReasonRequiredError,
} from "@/lib/bookings/status";
import { prisma } from "@/lib/db/prisma";
import {
  createFlightBooking,
  listBookings,
} from "@/server/services/booking-service";
import { transitionBooking } from "@/server/services/booking-status-service";
import { flushPendingBookingEmails } from "@/server/services/customer-email-service";

/**
 * Booking creation and lifecycle against the real database.
 *
 * The transition cases here complement the unit tests on the matrix: these
 * check that the service reads the stored record, enforces the evidence rules
 * against it, and writes history and audit atomically.
 */

const SUFFIX = Date.now();
let actorId: string;
let customerId: string;
const bookingIds: string[] = [];

interface BookingOverrides {
  status?: BookingStatus;
  ticketStatus?: TicketStatus;
  chargeOutcome?: ChargeOutcome;
  departureDate?: Date | undefined;
  airlineConfirmation?: string | undefined;
  ticketNumber?: string | undefined;
  withPassenger?: boolean;
}

/** A date `days` from now, for exercising the derived priority thresholds. */
function inDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1_000);
}

async function makeBooking(overrides: BookingOverrides = {}): Promise<string> {
  const {
    status = BookingStatus.PENDING,
    ticketStatus = TicketStatus.PENDING,
    chargeOutcome = ChargeOutcome.PENDING,
    departureDate,
    airlineConfirmation,
    ticketNumber,
    withPassenger = true,
  } = overrides;

  const { id } = await createFlightBooking(
    {
      booking: {
        customerId,
        chargeOutcome,
        ticketStatus,
        ...(departureDate === undefined ? {} : { departureDate }),
        mcoStatus: "NOT_APPLICABLE",
        currency: "USD",
        splitCharges: false,
        airlineConfirmation,
      } as never,
      amounts: {
        baseFareMinor: 90_000,
        taxesFeesMinor: 12_997,
        totalMinor: 102_997,
        supplierCostMinor: 92_697,
        grossMcoMinor: 102_997,
        netMcoMinor: 92_697,
      },
      passengers: withPassenger
        ? [
            {
              firstName: "Test",
              lastName: "Passenger",
              type: PassengerType.ADULT,
              ticketNumber,
            } as never,
          ]
        : [],
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
  // input. Fixtures needing a later status set it directly, rather than going
  // through the transition service, whose rules several of these tests are
  // themselves exercising.
  if (status !== BookingStatus.PENDING) {
    await prisma.booking.update({ where: { id }, data: { status } });
  }

  return id;
}

beforeAll(async () => {
  const actor = await prisma.adminUser.create({
    data: {
      email: `booking-test-${SUFFIX}@example.invalid`,
      name: "Booking Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  });
  actorId = actor.id;

  const customer = await prisma.customer.create({
    data: {
      reference: `CUS-TEST-${SUFFIX}`,
      firstName: "Booking",
      lastName: "Customer",
      email: `booking-customer-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
    },
    select: { id: true },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await flushPendingBookingEmails();
  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  // Confirming or ticketing a booking raises a customer-email Notification.
  // Notification.bookingId is SetNull on delete, so these must go first or
  // they survive as orphans that no later cleanup can find.
  await prisma.notification.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.adminUser.deleteMany({ where: { id: actorId } });
  await prisma.$disconnect();
});

describe("createFlightBooking", () => {
  it("persists the booking with its passengers and segments", async () => {
    const id = await makeBooking();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      include: { passengers: true, segments: true, flightDetail: true },
    });

    expect(booking.bookingNumber).toMatch(/^MV\d+$/);
    expect(booking.passengers).toHaveLength(1);
    expect(booking.segments).toHaveLength(1);
    expect(booking.flightDetail).not.toBeNull();
    expect(booking.customerId).toBe(customerId);
  });

  it("stores money as exact minor units", async () => {
    const id = await makeBooking();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { totalMinor: true, supplierCostMinor: true, currency: true },
    });

    // 1029.97 stored exactly, not 102996.99999999999 rounded.
    expect(booking.totalMinor).toBe(102_997);
    expect(booking.supplierCostMinor).toBe(92_697);
    expect(booking.currency).toBe("USD");
  });

  it("gives consecutive bookings different numbers", async () => {
    const [firstId, secondId] = await Promise.all([makeBooking(), makeBooking()]);

    const [first, second] = await Promise.all([
      prisma.booking.findUniqueOrThrow({
        where: { id: firstId },
        select: { bookingNumber: true },
      }),
      prisma.booking.findUniqueOrThrow({
        where: { id: secondId },
        select: { bookingNumber: true },
      }),
    ]);

    expect(first.bookingNumber).not.toBe(second.bookingNumber);
  });

  it("derives priority from the travelling date rather than any input", async () => {
    // Priority is no longer submitted. A booking travelling inside a week is
    // Urgent; one far out is Low — whatever the agent would have picked.
    const soon = await makeBooking({ departureDate: inDays(3) });
    const distant = await makeBooking({ departureDate: inDays(200) });
    const undated = await makeBooking();

    const [a, b, c] = await Promise.all(
      [soon, distant, undated].map((id) =>
        prisma.booking.findUniqueOrThrow({
          where: { id },
          select: { priority: true },
        }),
      ),
    );

    expect(a?.priority).toBe(BookingPriority.URGENT);
    expect(b?.priority).toBe(BookingPriority.LOW);
    expect(c?.priority).toBe(BookingPriority.NORMAL);
  });

  it("opens every booking as Pending whatever else is submitted", async () => {
    const id = await makeBooking();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true, chargeOutcome: true },
    });

    expect(booking.status).toBe(BookingStatus.PENDING);
    // The charge outcome is its own field and defaults to Pending.
    expect(booking.chargeOutcome).toBe(ChargeOutcome.PENDING);
  });

  it("stores the charge outcome the agent recorded", async () => {
    const id = await makeBooking({ chargeOutcome: ChargeOutcome.CHARGEBACK });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true, chargeOutcome: true },
    });

    expect(booking.chargeOutcome).toBe(ChargeOutcome.CHARGEBACK);
    // A chargeback does not drag the lifecycle status with it.
    expect(booking.status).toBe(BookingStatus.PENDING);
  });

  it("records the opening status in history from creation", async () => {
    const id = await makeBooking();

    const history = await prisma.bookingStatusHistory.findMany({
      where: { bookingId: id },
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.fromStatus).toBeNull();
    expect(history[0]?.toStatus).toBe(BookingStatus.PENDING);
  });

  it("writes an audit entry", async () => {
    const id = await makeBooking();

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Booking", entityId: id, action: "CREATE" },
    });

    expect(entry).not.toBeNull();
  });
});

describe("transitionBooking", () => {
  it("moves pending to confirmed when the evidence exists", async () => {
    const id = await makeBooking({ airlineConfirmation: "ABC123" });

    const result = await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    expect(result.fromStatus).toBe(BookingStatus.PENDING);
    expect(result.toStatus).toBe(BookingStatus.CONFIRMED);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(booking.status).toBe(BookingStatus.CONFIRMED);
  });

  it("refuses confirmation without a supplier reference", async () => {
    const id = await makeBooking({ airlineConfirmation: undefined });

    await expect(
      transitionBooking({
        bookingId: id,
        toStatus: BookingStatus.CONFIRMED,
        actorId,
      }),
    ).rejects.toBeInstanceOf(MissingEvidenceError);

    // The stored status must be untouched by the rejected attempt.
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(booking.status).toBe(BookingStatus.PENDING);
  });

  it("refuses confirmation with no passengers", async () => {
    const id = await makeBooking({
      airlineConfirmation: "ABC123",
      withPassenger: false,
    });

    await expect(
      transitionBooking({
        bookingId: id,
        toStatus: BookingStatus.CONFIRMED,
        actorId,
      }),
    ).rejects.toBeInstanceOf(MissingEvidenceError);
  });

  it("refuses a transition the matrix does not allow", async () => {
    const id = await makeBooking({ airlineConfirmation: "ABC123" });

    await expect(
      transitionBooking({
        bookingId: id,
        toStatus: BookingStatus.TICKETED,
        actorId,
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("refuses ticketing until a ticket was actually issued", async () => {
    const id = await makeBooking({ airlineConfirmation: "ABC123" });

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    // Ticket status is still Pending and no ticket number exists.
    await expect(
      transitionBooking({
        bookingId: id,
        toStatus: BookingStatus.TICKETED,
        actorId,
      }),
    ).rejects.toBeInstanceOf(MissingEvidenceError);
  });

  it("allows ticketing once the ticket evidence is present", async () => {
    const id = await makeBooking({
      airlineConfirmation: "ABC123",
      ticketStatus: TicketStatus.ISSUED,
      ticketNumber: "0062345678901",
    });

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });
    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.TICKETED,
      actorId,
    });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true, ticketedAt: true },
    });

    expect(booking.status).toBe(BookingStatus.TICKETED);
    // Reaching TICKETED stamps the date.
    expect(booking.ticketedAt).not.toBeNull();
  });

  it("requires a reason to cancel", async () => {
    const id = await makeBooking();

    await expect(
      transitionBooking({
        bookingId: id,
        toStatus: BookingStatus.CANCELLED,
        actorId,
      }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it("treats whitespace as no reason at all", async () => {
    const id = await makeBooking();

    await expect(
      transitionBooking({
        bookingId: id,
        toStatus: BookingStatus.CANCELLED,
        actorId,
        reason: "   ",
      }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it("records the reason, actor and both statuses in history", async () => {
    const id = await makeBooking();

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CANCELLED,
      actorId,
      reason: "Customer withdrew",
    });

    const entry = await prisma.bookingStatusHistory.findFirst({
      where: { bookingId: id, toStatus: BookingStatus.CANCELLED },
    });

    expect(entry?.fromStatus).toBe(BookingStatus.PENDING);
    expect(entry?.reason).toBe("Customer withdrew");
    expect(entry?.changedById).toBe(actorId);
  });

  it("writes a STATUS_CHANGE audit entry", async () => {
    const id = await makeBooking({ airlineConfirmation: "ABC123" });

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Booking", entityId: id, action: "STATUS_CHANGE" },
    });

    expect(entry).not.toBeNull();
  });

  it("treats a repeated submission of the current status as a no-op", async () => {
    const id = await makeBooking();

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.PENDING,
      actorId,
    });

    // Only the creation entry; no spurious PENDING → PENDING row.
    const history = await prisma.bookingStatusHistory.count({
      where: { bookingId: id },
    });
    expect(history).toBe(1);
  });

  it("refuses any move out of cancelled", async () => {
    const id = await makeBooking();

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CANCELLED,
      actorId,
      reason: "Test",
    });

    await expect(
      transitionBooking({
        bookingId: id,
        toStatus: BookingStatus.PENDING,
        actorId,
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe("listBookings", () => {
  it("filters by status", async () => {
    const id = await makeBooking();
    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CANCELLED,
      actorId,
      reason: "Filter test",
    });

    const cancelled = await listBookings(
      { status: BookingStatus.CANCELLED },
      { page: 1, pageSize: 100 },
    );

    expect(cancelled.rows.map((row) => row.id)).toContain(id);
    expect(
      cancelled.rows.every((row) => row.status === BookingStatus.CANCELLED),
    ).toBe(true);
  });

  it("finds a booking by its number", async () => {
    const id = await makeBooking();
    const { bookingNumber } = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { bookingNumber: true },
    });

    const result = await listBookings(
      { q: bookingNumber },
      { page: 1, pageSize: 25 },
    );

    expect(result.rows.map((row) => row.id)).toContain(id);
  });

  it("finds a booking by the customer's email", async () => {
    const id = await makeBooking();

    const result = await listBookings(
      { q: `booking-customer-${SUFFIX}` },
      { page: 1, pageSize: 100 },
    );

    expect(result.rows.map((row) => row.id)).toContain(id);
  });

  it("paginates", async () => {
    const result = await listBookings({}, { page: 1, pageSize: 2 });

    expect(result.rows.length).toBeLessThanOrEqual(2);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });
});
