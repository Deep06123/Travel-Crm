import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  AuditAction,
  BookingPriority,
  BookingStatus,
  ChargeOutcome,
  CustomerStatus,
  PassengerType,
  PaymentMethod,
  PaymentStatus,
  TicketStatus,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import {
  InvalidTransitionError,
  MissingEvidenceError,
  ReasonRequiredError,
} from "@/lib/bookings/status";
import { McoNotUpdatableError } from "@/lib/bookings/mco";
import { prisma } from "@/lib/db/prisma";
import {
  BookingNotDeletableError,
  createFlightBooking,
  deleteBooking,
  listBookings,
} from "@/server/services/booking-service";
import { transitionBooking } from "@/server/services/booking-status-service";
import { updateMco } from "@/server/services/mco-service";
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
/** Reference rows this file creates, cleaned up with the rest. */
const mcoSupplierIds: string[] = [];
/** Keeps each fixture signature's token hash unique within the run. */
let signatureCount = 0;

interface BookingOverrides {
  status?: BookingStatus;
  ticketStatus?: TicketStatus;
  chargeOutcome?: ChargeOutcome;
  departureDate?: Date | undefined;
  airlineConfirmation?: string | undefined;
  ticketNumber?: string | undefined;
  withPassenger?: boolean;
  /** Defaults to a real amount, which is what opens the MCO as Pending. */
  grossMcoMinor?: number;
  netMcoMinor?: number;
}

/** A date `days` from now, for exercising the derived priority thresholds. */
function inDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1_000);
}

/**
 * One authorization request against a booking, written directly.
 *
 * Not through `sendAuthorizationEmail`, which mints a token, revokes earlier
 * rows and talks to a mail server. What the list reads is the stored shape,
 * and these cases are about how several rows are reduced to one answer —
 * which is a fact about the rows, not about how they came to exist.
 */
async function makeSignature(
  bookingId: string,
  { sentAt, signedAt }: { sentAt: Date; signedAt?: Date },
): Promise<string> {
  signatureCount += 1;

  const { id } = await prisma.bookingSignature.create({
    data: {
      bookingId,
      // Unique per row, and never a real token — nothing here is signable.
      tokenHash: `test-${SUFFIX}-${signatureCount}`,
      status: signedAt ? "SIGNED" : "SENT",
      recipientEmail: `sig-${SUFFIX}@example.invalid`,
      sentAt,
      expiresAt: new Date(sentAt.getTime() + 14 * 24 * 60 * 60 * 1_000),
      ...(signedAt ? { signedAt, signatureName: "Test Customer" } : {}),
    },
    select: { id: true },
  });

  return id;
}

/** The booking's row as the list builds it, with the page filtered to it. */
async function findListRow(bookingId: string) {
  const { bookingNumber } = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { bookingNumber: true },
  });

  const result = await listBookings(
    { q: bookingNumber },
    { page: 1, pageSize: 25 },
  );

  const row = result.rows.find((candidate) => candidate.id === bookingId);
  if (!row) throw new Error(`Booking ${bookingNumber} is not in the list`);

  return row;
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
    grossMcoMinor = 102_997,
    netMcoMinor = 92_697,
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
        grossMcoMinor,
        netMcoMinor,
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
  await prisma.mcoSupplier.deleteMany({ where: { id: { in: mcoSupplierIds } } });
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

  /**
   * Confirmation is settled before the locator comes back.
   *
   * It is routinely agreed by phone, so requiring the reference left a
   * booking the agent knew was held reading as unconfirmed until the
   * airline's paperwork caught up. Ticketing still requires it — covered
   * below — which is where the reference is evidence of something.
   */
  it("confirms a booking that has no reference yet", async () => {
    const id = await makeBooking({ airlineConfirmation: undefined });

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true, airlineConfirmation: true },
    });

    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.airlineConfirmation).toBeNull();
  });

  /**
   * The reference still gates the ticket, from a booking confirmed without
   * one. This is the pairing the relaxation rests on: confirming early is
   * only safe because ticketing cannot follow it through on nothing.
   */
  it("still refuses ticketing a booking confirmed without a reference", async () => {
    const id = await makeBooking({
      airlineConfirmation: undefined,
      ticketNumber: "0012345678901",
    });

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    await prisma.booking.update({
      where: { id },
      data: { ticketStatus: TicketStatus.ISSUED },
    });

    await expect(
      transitionBooking({
        bookingId: id,
        toStatus: BookingStatus.TICKETED,
        actorId,
      }),
    ).rejects.toBeInstanceOf(MissingEvidenceError);
  });

  /**
   * Confirmation carries no evidence requirement at all.
   *
   * Neither a reference nor a passenger. Asserted against a booking missing
   * both, so this fails loudly if either is reintroduced — the matrix is the
   * only thing still governing CONFIRMED.
   */
  it("confirms a booking carrying neither a reference nor a passenger", async () => {
    const id = await makeBooking({
      airlineConfirmation: undefined,
      withPassenger: false,
    });

    await transitionBooking({
      bookingId: id,
      toStatus: BookingStatus.CONFIRMED,
      actorId,
    });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });

    expect(booking.status).toBe(BookingStatus.CONFIRMED);
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

  it("reports a booking with no authorization email as never sent", async () => {
    const id = await makeBooking();

    const row = await findListRow(id);

    expect(row.latestSignature).toBeNull();
    expect(row.authorizedAt).toBeNull();
  });

  it("carries the newest authorization request", async () => {
    const id = await makeBooking();
    await makeSignature(id, { sentAt: new Date("2026-11-01T09:00:00Z") });
    const newest = await makeSignature(id, {
      sentAt: new Date("2026-11-08T09:00:00Z"),
    });

    const row = await findListRow(id);

    expect(row.latestSignature?.id).toBe(newest);
    expect(row.authorizedAt).toBeNull();
  });

  /**
   * The case the separate `authorizedAt` lookup exists for.
   *
   * Resending leaves the signed row alone and writes a new unsigned one on
   * top, so the newest row reads SENT on a booking that is plainly authorized.
   * Reading consent off that row would un-authorize the booking every time
   * somebody resent the email.
   */
  it("keeps the signed date when a later request was sent on top", async () => {
    const id = await makeBooking();
    const signedAt = new Date("2026-11-01T10:00:00Z");
    await makeSignature(id, { sentAt: new Date("2026-11-01T09:00:00Z"), signedAt });
    const resent = await makeSignature(id, {
      sentAt: new Date("2026-11-08T09:00:00Z"),
    });

    const row = await findListRow(id);

    expect(row.latestSignature?.id).toBe(resent);
    expect(row.latestSignature?.signedAt).toBeNull();
    expect(row.authorizedAt).toEqual(signedAt);
  });

  it("reports the first signing when a booking was authorized twice", async () => {
    const id = await makeBooking();
    const first = new Date("2026-11-01T10:00:00Z");
    await makeSignature(id, {
      sentAt: new Date("2026-11-01T09:00:00Z"),
      signedAt: first,
    });
    await makeSignature(id, {
      sentAt: new Date("2026-11-08T09:00:00Z"),
      signedAt: new Date("2026-11-08T10:00:00Z"),
    });

    const row = await findListRow(id);

    expect(row.authorizedAt).toEqual(first);
  });
});

describe("opening MCO status", () => {
  /**
   * Neither booking form submits an MCO status, so every row used to take the
   * schema default of N/A — including rows carrying a gross MCO, which then
   * read "no MCO" over a booking that had one.
   */
  it("raises the MCO on a booking created with an amount", async () => {
    const id = await makeBooking();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { mcoStatus: true, grossMcoMinor: true },
    });

    expect(booking.grossMcoMinor).toBeGreaterThan(0);
    expect(booking.mcoStatus).toBe("PENDING");
  });

  it("leaves a booking with no MCO amount at N/A", async () => {
    const id = await makeBooking({ grossMcoMinor: 0, netMcoMinor: 0 });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { mcoStatus: true },
    });

    expect(booking.mcoStatus).toBe("NOT_APPLICABLE");
  });
});

describe("deleteBooking", () => {
  /** The booking number, which the delete demands typed back verbatim. */
  async function numberOf(id: string): Promise<string> {
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { bookingNumber: true },
    });
    return row.bookingNumber;
  }

  it("removes the booking and everything that only describes it", async () => {
    const id = await makeBooking();
    const bookingNumber = await numberOf(id);

    const result = await deleteBooking({
      bookingId: id,
      actorId,
      reason: "Duplicate of an earlier booking.",
      confirmation: bookingNumber,
    });

    expect(result.bookingNumber).toBe(bookingNumber);

    expect(await prisma.booking.findUnique({ where: { id } })).toBeNull();

    // Cascaded relations go with it rather than lingering as orphans.
    expect(await prisma.passenger.count({ where: { bookingId: id } })).toBe(0);
    expect(await prisma.flightSegment.count({ where: { bookingId: id } })).toBe(0);
    expect(
      await prisma.bookingStatusHistory.count({ where: { bookingId: id } }),
    ).toBe(0);
  });

  it("leaves an audit entry behind as the only trace", async () => {
    const id = await makeBooking();
    const bookingNumber = await numberOf(id);

    await deleteBooking({
      bookingId: id,
      actorId,
      reason: "Created against the wrong customer.",
      confirmation: bookingNumber,
    });

    const entries = await prisma.auditLog.findMany({
      where: { entityId: id, action: AuditAction.DELETE },
      select: { summary: true },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.summary).toContain(bookingNumber);
    expect(entries[0]?.summary).toContain("wrong customer");
  });

  it("refuses when the typed confirmation does not match", async () => {
    const id = await makeBooking();

    await expect(
      deleteBooking({
        bookingId: id,
        actorId,
        reason: "Mistake.",
        confirmation: "MV00000",
      }),
    ).rejects.toThrow(BookingNotDeletableError);

    expect(await prisma.booking.findUnique({ where: { id } })).not.toBeNull();
  });

  it("refuses a booking that has money recorded against it", async () => {
    const id = await makeBooking();
    const bookingNumber = await numberOf(id);

    await prisma.payment.create({
      data: {
        reference: `PAY-DEL-${SUFFIX}`,
        bookingId: id,
        amountMinor: 102_997,
        currency: "USD",
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
      },
    });

    await expect(
      deleteBooking({
        bookingId: id,
        actorId,
        reason: "Wrong booking.",
        confirmation: bookingNumber,
      }),
    ).rejects.toThrow(BookingNotDeletableError);

    expect(await prisma.booking.findUnique({ where: { id } })).not.toBeNull();

    // Restrict would have refused this at the database anyway; the point is
    // that the operator gets a sentence instead of a foreign-key error.
    await prisma.payment.deleteMany({ where: { bookingId: id } });
  });

  it("refuses once a ticket has been issued", async () => {
    const id = await makeBooking({ ticketStatus: TicketStatus.ISSUED });
    const bookingNumber = await numberOf(id);

    await expect(
      deleteBooking({
        bookingId: id,
        actorId,
        reason: "Wrong booking.",
        confirmation: bookingNumber,
      }),
    ).rejects.toThrow(BookingNotDeletableError);
  });
});

/**
 * Submitting an MCO to its supplier.
 *
 * The evidence rule is a named supplier, and only that. It used to demand a
 * gross MCO amount as well, which blocked the ordinary case — the figure is
 * frequently agreed with the supplier after the claim is raised — from a
 * panel that cannot set the amount, so the refusal was a dead end rather than
 * a prompt.
 */
describe("updateMco", () => {
  let supplierId: string;

  beforeAll(async () => {
    const supplier = await prisma.mcoSupplier.create({
      data: { name: `MCO Supplier ${SUFFIX}` },
      select: { id: true },
    });
    supplierId = supplier.id;
    mcoSupplierIds.push(supplier.id);
  });

  /** A booking with its MCO raised and no amount against it. */
  async function bookingWithRaisedMco(): Promise<string> {
    const id = await makeBooking({ grossMcoMinor: 0, netMcoMinor: 0 });
    await updateMco({
      bookingId: id,
      actorId,
      toStatus: "PENDING",
    });
    return id;
  }

  it("submits an MCO that carries no amount yet", async () => {
    const id = await bookingWithRaisedMco();

    const result = await updateMco({
      bookingId: id,
      actorId,
      mcoSupplierId: supplierId,
      toStatus: "SUBMITTED",
    });

    expect(result.statusChanged).toBe(true);
    expect(result.toStatus).toBe("SUBMITTED");

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { mcoStatus: true, grossMcoMinor: true },
    });

    expect(booking.mcoStatus).toBe("SUBMITTED");
    expect(booking.grossMcoMinor).toBe(0);
  });

  it("still refuses to submit without a supplier", async () => {
    const id = await bookingWithRaisedMco();

    await expect(
      updateMco({ bookingId: id, actorId, toStatus: "SUBMITTED" }),
    ).rejects.toBeInstanceOf(McoNotUpdatableError);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { mcoStatus: true },
    });

    expect(booking.mcoStatus).toBe("PENDING");
  });

  it("accepts a supplier named in the same submission", async () => {
    const id = await bookingWithRaisedMco();

    const result = await updateMco({
      bookingId: id,
      actorId,
      mcoSupplierId: supplierId,
      toStatus: "SUBMITTED",
    });

    expect(result.supplierChanged).toBe(true);
    expect(result.statusChanged).toBe(true);
  });
});
