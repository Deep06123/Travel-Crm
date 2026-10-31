import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  ChargeOutcome,
  CustomerStatus,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { createCruiseBooking } from "@/server/services/booking-service";
import {
  TicketedTravellerError,
  updateBookingBilling,
  updateBookingOverview,
  updateBookingTravellers,
  updateCruiseDetail,
} from "@/server/services/booking-edit-service";

/**
 * Correcting a booking after it was taken.
 *
 * The properties that matter here are the ones that make an edit safe to
 * offer at all: that a blank clears a field rather than being ignored, that
 * an unchanged save writes nothing, that a traveller keeps their identity
 * across a correction, and that a role which cannot see passport details
 * cannot blank them by saving a form that never showed them.
 */

const SUFFIX = Date.now();
let actorId: string;
let customerId: string;
const bookingIds: string[] = [];

async function makeBooking(): Promise<string> {
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
        cabinCount: 1,
        sailDate: new Date("2027-06-12T00:00:00Z"),
        returnDate: new Date("2027-06-19T00:00:00Z"),
        gratuitiesIncluded: false,
        insuranceIncluded: false,
        contactName: "Original Contact",
        contactPhone: "555-0100",
      } as never,
      amounts: {
        baseFareMinor: 0,
        taxesFeesMinor: 0,
        totalMinor: 0,
        supplierCostMinor: 0,
        grossMcoMinor: 0,
        netMcoMinor: 0,
      },
      guests: [
        { firstName: "Perpetua", lastName: "Original", type: "ADULT" },
        { firstName: "Second", lastName: "Original", type: "ADULT" },
      ] as never,
    },
    actorId,
  );

  bookingIds.push(id);
  return id;
}

/** Everything the overview editor sends, so one field can be varied. */
function overviewInput(bookingId: string, overrides: Record<string, unknown>) {
  return {
    bookingId,
    chargeOutcome: ChargeOutcome.PENDING,
    ...overrides,
  } as never;
}

beforeAll(async () => {
  const actor = await prisma.adminUser.create({
    data: {
      email: `edit-test-${SUFFIX}@example.invalid`,
      name: "Edit Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  });
  actorId = actor.id;

  const customer = await prisma.customer.create({
    data: {
      reference: `CUS-EDIT-${SUFFIX}`,
      firstName: "Edit",
      lastName: "Customer",
      email: `edit-customer-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
    },
    select: { id: true },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.adminUser.deleteMany({ where: { id: actorId } });
  await prisma.$disconnect();
});

describe("updateBookingOverview", () => {
  it("fills in a field that was left empty", async () => {
    const id = await makeBooking();

    await updateBookingOverview(
      overviewInput(id, {
        source: "Inbound call",
        contactEmail: "late@example.invalid",
      }),
      actorId,
    );

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { source: true, contactEmail: true },
    });

    expect(booking.source).toBe("Inbound call");
    expect(booking.contactEmail).toBe("late@example.invalid");
  });

  it("clears a field that was filled in wrongly", async () => {
    const id = await makeBooking();

    // Everything else omitted, which is what a cleared form submits.
    await updateBookingOverview(overviewInput(id, {}), actorId);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { contactName: true, contactPhone: true },
    });

    expect(booking.contactName).toBeNull();
    expect(booking.contactPhone).toBeNull();
  });

  it("keeps the booking date when the field is left blank", async () => {
    const id = await makeBooking();

    const before = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { bookedAt: true },
    });

    await updateBookingOverview(overviewInput(id, {}), actorId);

    const after = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { bookedAt: true },
    });

    expect(after.bookedAt.toISOString()).toBe(before.bookedAt.toISOString());
  });

  it("writes nothing when nothing moved", async () => {
    const id = await makeBooking();

    const result = await updateBookingOverview(
      overviewInput(id, {
        contactName: "Original Contact",
        contactPhone: "555-0100",
      }),
      actorId,
    );

    expect(result.changed).toBe(0);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Booking", entityId: id, action: "UPDATE" },
    });
    expect(entry).toBeNull();
  });

  it("records the before and after of what did move", async () => {
    const id = await makeBooking();

    await updateBookingOverview(
      overviewInput(id, { contactName: "Corrected Contact" }),
      actorId,
    );

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Booking", entityId: id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });

    expect(entry?.changes).toMatchObject({
      contactName: { before: "Original Contact", after: "Corrected Contact" },
    });
  });
});

describe("updateBookingBilling", () => {
  it("records a card that was never taken down", async () => {
    const id = await makeBooking();

    await updateBookingBilling(
      {
        bookingId: id,
        cardHolderName: "A Traveller",
        cardType: "VISA",
        cardLast4: "1111",
        // Deliberately in the past: this edits a record of what was charged.
        cardExpiry: "0120",
        billingCity: "Galveston",
      } as never,
      actorId,
    );

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: {
        cardHolderName: true,
        cardType: true,
        cardLast4: true,
        cardExpiry: true,
        billingCity: true,
      },
    });

    expect(booking.cardHolderName).toBe("A Traveller");
    expect(booking.cardType).toBe("VISA");
    expect(booking.cardLast4).toBe("1111");
    expect(booking.cardExpiry).toBe("0120");
    expect(booking.billingCity).toBe("Galveston");
  });
});

describe("updateCruiseDetail", () => {
  it("corrects the sailing and moves the booking's travel dates with it", async () => {
    const id = await makeBooking();

    await updateCruiseDetail(
      {
        bookingId: id,
        cruiseLine: "Carnival",
        cabinCount: 2,
        sailDate: new Date("2027-07-01T00:00:00Z"),
        returnDate: new Date("2027-07-08T00:00:00Z"),
        gratuitiesIncluded: true,
        insuranceIncluded: false,
      } as never,
      actorId,
    );

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: {
        travelStartDate: true,
        travelEndDate: true,
        cruiseDetail: true,
      },
    });

    expect(booking.cruiseDetail?.cruiseLine).toBe("Carnival");
    expect(booking.cruiseDetail?.cabinCount).toBe(2);
    expect(booking.cruiseDetail?.gratuitiesIncluded).toBe(true);
    // The lists, reports and calendar read the dates off the booking, so a
    // sailing that moves has to move them too.
    expect(booking.travelStartDate?.toISOString()).toBe(
      "2027-07-01T00:00:00.000Z",
    );
    expect(booking.travelEndDate?.toISOString()).toBe(
      "2027-07-08T00:00:00.000Z",
    );
    // The ship was not sent, so it is cleared rather than kept.
    expect(booking.cruiseDetail?.ship).toBeNull();
  });
});

describe("updateBookingTravellers", () => {
  it("corrects a name without replacing the traveller", async () => {
    const id = await makeBooking();

    const before = await prisma.passenger.findMany({
      where: { bookingId: id },
      orderBy: { sequence: "asc" },
    });

    await updateBookingTravellers(
      {
        bookingId: id,
        canEditSensitive: true,
        travellers: before.map((row) => ({
          id: row.id,
          firstName: row.sequence === 1 ? "Perpetuah" : row.firstName,
          lastName: row.lastName,
          type: "ADULT",
        })) as never,
      },
      actorId,
    );

    const after = await prisma.passenger.findMany({
      where: { bookingId: id },
      orderBy: { sequence: "asc" },
    });

    expect(after).toHaveLength(2);
    expect(after[0]?.firstName).toBe("Perpetuah");
    // Same row, so anything pointing at this traveller still does.
    expect(after[0]?.id).toBe(before[0]?.id);
  });

  it("adds a traveller who was left off", async () => {
    const id = await makeBooking();

    const before = await prisma.passenger.findMany({
      where: { bookingId: id },
      orderBy: { sequence: "asc" },
    });

    await updateBookingTravellers(
      {
        bookingId: id,
        canEditSensitive: true,
        travellers: [
          ...before.map((row) => ({
            id: row.id,
            firstName: row.firstName,
            lastName: row.lastName,
            type: "ADULT",
          })),
          { firstName: "Forgotten", lastName: "Traveller", type: "CHILD" },
        ] as never,
      },
      actorId,
    );

    const after = await prisma.passenger.findMany({
      where: { bookingId: id },
      orderBy: { sequence: "asc" },
    });

    expect(after).toHaveLength(3);
    expect(after[2]?.firstName).toBe("Forgotten");
    expect(after[2]?.sequence).toBe(3);
  });

  it("removes a traveller left out of the list", async () => {
    const id = await makeBooking();

    const before = await prisma.passenger.findMany({
      where: { bookingId: id },
      orderBy: { sequence: "asc" },
    });

    await updateBookingTravellers(
      {
        bookingId: id,
        canEditSensitive: true,
        travellers: [
          {
            id: before[0]?.id,
            firstName: "Perpetua",
            lastName: "Original",
            type: "ADULT",
          },
        ] as never,
      },
      actorId,
    );

    const after = await prisma.passenger.findMany({
      where: { bookingId: id },
    });

    expect(after).toHaveLength(1);
  });

  it("refuses to remove a traveller who holds a ticket", async () => {
    const id = await makeBooking();

    const before = await prisma.passenger.findMany({
      where: { bookingId: id },
      orderBy: { sequence: "asc" },
    });

    await prisma.passenger.update({
      where: { id: before[1]!.id },
      data: { ticketNumber: "001-2345678901" },
    });

    await expect(
      updateBookingTravellers(
        {
          bookingId: id,
          canEditSensitive: true,
          travellers: [
            {
              id: before[0]?.id,
              firstName: "Perpetua",
              lastName: "Original",
              type: "ADULT",
            },
          ] as never,
        },
        actorId,
      ),
    ).rejects.toThrow(TicketedTravellerError);

    // And nothing was removed on the way to refusing.
    const after = await prisma.passenger.findMany({ where: { bookingId: id } });
    expect(after).toHaveLength(2);
  });

  it("leaves passport details alone for a role that cannot see them", async () => {
    const id = await makeBooking();

    const before = await prisma.passenger.findMany({
      where: { bookingId: id },
      orderBy: { sequence: "asc" },
    });

    await prisma.passenger.update({
      where: { id: before[0]!.id },
      data: {
        passportNumber: "X1234567",
        dateOfBirth: new Date("1980-02-03T00:00:00Z"),
      },
    });

    // The form such a role submits carries no passport fields at all.
    await updateBookingTravellers(
      {
        bookingId: id,
        canEditSensitive: false,
        travellers: before.map((row) => ({
          id: row.id,
          firstName: row.firstName,
          lastName: "Corrected",
          type: "ADULT",
        })) as never,
      },
      actorId,
    );

    const after = await prisma.passenger.findUniqueOrThrow({
      where: { id: before[0]!.id },
    });

    expect(after.lastName).toBe("Corrected");
    // Not blanked by a form that never showed them.
    expect(after.passportNumber).toBe("X1234567");
    expect(after.dateOfBirth?.toISOString()).toBe("1980-02-03T00:00:00.000Z");
  });
});
