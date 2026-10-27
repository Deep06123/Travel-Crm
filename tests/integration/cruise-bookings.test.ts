import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  BookingProduct,
  BookingStatus,
  ChargeOutcome,
  CustomerStatus,
  TicketStatus,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import {
  createCruiseBooking,
  listBookings,
} from "@/server/services/booking-service";
import { transitionBooking } from "@/server/services/booking-status-service";
import { flushPendingBookingEmails } from "@/server/services/customer-email-service";

/**
 * Cruise bookings against the real database.
 *
 * The important property here is separation: a cruise record must not carry
 * airline fields, and must not appear in the ticketing backlog that flight
 * operations works from.
 */

const SUFFIX = Date.now();
let actorId: string;
let customerId: string;
const bookingIds: string[] = [];

async function makeCruiseBooking(
  overrides: Partial<Parameters<typeof createCruiseBooking>[0]["booking"]> = {},
  guestCount = 2,
  guestOverrides: Record<string, unknown> = {},
): Promise<string> {
  const { id } = await createCruiseBooking(
    {
      booking: {
        customerId,
        chargeOutcome: ChargeOutcome.PENDING,
        mcoStatus: "NOT_APPLICABLE",
        currency: "USD",
        splitCharges: false,
        cruiseLine: "Royal Caribbean",
        ship: "Symphony of the Seas",
        reservationNumber: `RES${SUFFIX}`,
        departurePort: "Miami",
        arrivalPort: "Miami",
        nights: 7,
        sailingName: "7 Night Eastern Caribbean from Miami Cruise",
        specialRequest: "Name change",
        deckNumber: "Deck 10",
        cabinNumber: "10234",
        cabinCategory: "Balcony",
        cabinCount: 1,
        sailDate: new Date("2027-06-12T00:00:00Z"),
        returnDate: new Date("2027-06-19T00:00:00Z"),
        gratuitiesIncluded: true,
        insuranceIncluded: false,
        ...overrides,
      } as never,
      amounts: {
        baseFareMinor: 240_000,
        taxesFeesMinor: 41_250,
        totalMinor: 281_250,
        supplierCostMinor: 253_125,
        grossMcoMinor: 281_250,
        netMcoMinor: 253_125,
      },
      guests: Array.from({ length: guestCount }, (_, index) => ({
        firstName: `Guest${index + 1}`,
        lastName: "Traveller",
        type: "ADULT",
        ...guestOverrides,
      })) as never,
    },
    actorId,
  );

  bookingIds.push(id);
  return id;
}

beforeAll(async () => {
  const actor = await prisma.adminUser.create({
    data: {
      email: `cruise-test-${SUFFIX}@example.invalid`,
      name: "Cruise Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  });
  actorId = actor.id;

  const customer = await prisma.customer.create({
    data: {
      reference: `CUS-CRUISE-${SUFFIX}`,
      firstName: "Cruise",
      lastName: "Customer",
      email: `cruise-customer-${SUFFIX}@example.invalid`,
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

describe("createCruiseBooking", () => {
  it("persists the sailing detail", async () => {
    const id = await makeCruiseBooking();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      include: { cruiseDetail: true, passengers: true },
    });

    expect(booking.product).toBe(BookingProduct.CRUISE);
    expect(booking.cruiseDetail?.cruiseLine).toBe("Royal Caribbean");
    expect(booking.cruiseDetail?.ship).toBe("Symphony of the Seas");
    expect(booking.cruiseDetail?.nights).toBe(7);
    expect(booking.cruiseDetail?.cabinCategory).toBe("Balcony");
    expect(booking.cruiseDetail?.gratuitiesIncluded).toBe(true);
  });

  it("persists the sailing name, deck and special request", async () => {
    const id = await makeCruiseBooking();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      include: { cruiseDetail: true },
    });

    // The authorisation document prints the sailing title alongside the
    // numeric night count, so both must survive the round trip.
    expect(booking.cruiseDetail?.sailingName).toBe(
      "7 Night Eastern Caribbean from Miami Cruise",
    );
    expect(booking.cruiseDetail?.nights).toBe(7);
    expect(booking.cruiseDetail?.deckNumber).toBe("Deck 10");
    expect(booking.cruiseDetail?.specialRequest).toBe("Name change");
  });

  it("records a guest's gender and previous name", async () => {
    const id = await makeCruiseBooking({}, 1, {
      gender: "Female",
      previousFirstName: "Kimberly",
      previousLastName: "Harlow",
    });

    const [guest] = await prisma.passenger.findMany({
      where: { bookingId: id },
      orderBy: { sequence: "asc" },
    });

    expect(guest?.gender).toBe("Female");
    expect(guest?.previousFirstName).toBe("Kimberly");
    expect(guest?.previousLastName).toBe("Harlow");
  });

  it("leaves the previous name null when no name change is recorded", async () => {
    const id = await makeCruiseBooking({}, 1);

    const [guest] = await prisma.passenger.findMany({
      where: { bookingId: id },
      orderBy: { sequence: "asc" },
    });

    expect(guest?.previousFirstName).toBeNull();
    expect(guest?.previousLastName).toBeNull();
  });

  it("writes no flight detail", async () => {
    const id = await makeCruiseBooking();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      include: { flightDetail: true, segments: true },
    });

    // A cruise record must not acquire airline columns.
    expect(booking.flightDetail).toBeNull();
    expect(booking.segments).toHaveLength(0);
  });

  it("marks ticketing as not applicable", async () => {
    const id = await makeCruiseBooking();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { ticketStatus: true, ticketedAt: true },
    });

    // A cruise is confirmed by the cruise line, not ticketed by an airline, so
    // it must never sit in the ticketing backlog.
    expect(booking.ticketStatus).toBe(TicketStatus.NOT_APPLICABLE);
    expect(booking.ticketedAt).toBeNull();
  });

  it("supports multiple guests", async () => {
    const id = await makeCruiseBooking({}, 4);

    const passengers = await prisma.passenger.findMany({
      where: { bookingId: id },
      orderBy: { sequence: "asc" },
    });

    expect(passengers).toHaveLength(4);
    expect(passengers.map((p) => p.sequence)).toEqual([1, 2, 3, 4]);
    // Guests hold a cabin, not a ticket.
    expect(passengers.every((p) => p.ticketNumber === null)).toBe(true);
    expect(passengers.every((p) => p.cabinNumber === "10234")).toBe(true);
  });

  it("records multiple cabins", async () => {
    const id = await makeCruiseBooking({ cabinCount: 3 } as never);

    const detail = await prisma.cruiseDetail.findFirstOrThrow({
      where: { bookingId: id },
      select: { cabinCount: true },
    });

    expect(detail.cabinCount).toBe(3);
  });

  it("stores money as exact minor units", async () => {
    const id = await makeCruiseBooking();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { totalMinor: true, baseFareMinor: true, currency: true },
    });

    expect(booking.totalMinor).toBe(281_250);
    expect(booking.baseFareMinor).toBe(240_000);
    expect(booking.currency).toBe("USD");
  });

  it("maps the sail and return dates onto the booking's travel window", async () => {
    const id = await makeCruiseBooking();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { travelStartDate: true, travelEndDate: true },
    });

    expect(booking.travelStartDate?.toISOString()).toBe("2027-06-12T00:00:00.000Z");
    expect(booking.travelEndDate?.toISOString()).toBe("2027-06-19T00:00:00.000Z");
  });

  it("records the opening status in history", async () => {
    const id = await makeCruiseBooking();

    const history = await prisma.bookingStatusHistory.findMany({
      where: { bookingId: id },
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.toStatus).toBe(BookingStatus.PENDING);
  });

  it("writes an audit entry naming it a cruise booking", async () => {
    const id = await makeCruiseBooking();

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Booking", entityId: id, action: "CREATE" },
    });

    expect(entry.summary).toContain("cruise");
  });
});

describe("cruise lifecycle", () => {
  it("confirms once the cruise line reference is recorded", async () => {
    const id = await makeCruiseBooking({
      confirmationReference: "RCL-884213",
    } as never);

    const result = await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    expect(result.toStatus).toBe(BookingStatus.CONFIRMED);
  });

  it("cannot be ticketed, because ticketing does not apply", async () => {
    const id = await makeCruiseBooking({
      confirmationReference: "RCL-884213",
    } as never);

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    // Ticket status is NOT_APPLICABLE and no guest holds a ticket number, so
    // the evidence check refuses the move.
    await expect(
      transitionBooking({
        bookingId: id,
        toStatus: BookingStatus.TICKETED,
        actorId,
      }),
    ).rejects.toThrow();
  });
});

describe("listBookings with cruises", () => {
  it("returns cruise bookings alongside flights", async () => {
    const id = await makeCruiseBooking();

    const result = await listBookings(
      { q: `cruise-customer-${SUFFIX}` },
      { page: 1, pageSize: 100 },
    );

    const row = result.rows.find((candidate) => candidate.id === id);
    expect(row).toBeDefined();
    expect(row?.product).toBe(BookingProduct.CRUISE);
  });

  it("excludes cruises from the pending-ticketing filter", async () => {
    const id = await makeCruiseBooking();

    const pendingTicketing = await listBookings(
      { ticketStatus: TicketStatus.PENDING },
      { page: 1, pageSize: 200 },
    );

    expect(pendingTicketing.rows.map((row) => row.id)).not.toContain(id);
  });
});
