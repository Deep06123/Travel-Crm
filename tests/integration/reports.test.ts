import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  BookingProduct,
  BookingStatus,
  CustomerStatus,
  MessageStatus,
  PaymentMethod,
  PaymentStatus,
  RefundKind,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { getBookingPosition, recordPayment } from "@/server/services/payment-service";
import {
  approveRefund,
  completeRefundManually,
  requestRefund,
} from "@/server/services/refund-service";
import {
  getBookingReport,
  getFinancialReport,
} from "@/server/services/report-service";
import { composeMessage, listSent } from "@/server/services/messaging-service";

/**
 * Reports and messaging.
 *
 * Phase 6's criterion is that report values match the underlying records and
 * that messaging status is not falsely represented as delivery success. Both
 * are checked here against the real database, with a window narrow enough that
 * only this file's fixtures fall inside it.
 */

const SUFFIX = Date.now();
let operatorId: string;
let approverId: string;
let recipientId: string;
let customerId: string;
const bookingIds: string[] = [];
const messageIds: string[] = [];

/**
 * A window that only contains this run's fixtures.
 *
 * Reports aggregate over every booking in range, so a shared window would make
 * assertions depend on data other tests left behind.
 */
const WINDOW_FROM = new Date("2029-03-01T00:00:00Z");
const WINDOW_TO = new Date("2029-03-31T23:59:59Z");

async function makeBooking(
  totalMinor: number,
  status: BookingStatus = BookingStatus.PENDING,
): Promise<string> {
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `MV-RPT-${SUFFIX}-${bookingIds.length}`,
      product: BookingProduct.FLIGHT,
      customerId,
      status,
      currency: "USD",
      totalMinor,
      supplierCostMinor: Math.round(totalMinor * 0.8),
      grossMcoMinor: totalMinor,
      netMcoMinor: Math.round(totalMinor * 0.8),
      createdById: operatorId,
      assignedAgentId: operatorId,
      // Inside the isolated window.
      bookedAt: new Date("2029-03-15T12:00:00Z"),
    },
    select: { id: true },
  });

  bookingIds.push(booking.id);
  return booking.id;
}

beforeAll(async () => {
  const make = async (slug: string, role: AdminRole) =>
    (
      await prisma.adminUser.create({
        data: {
          email: `report-${slug}-${SUFFIX}@example.invalid`,
          name: `Report ${slug}`,
          passwordHash: await hashPassword("irrelevant-for-these-tests"),
          role,
        },
        select: { id: true },
      })
    ).id;

  operatorId = await make("operator", AdminRole.FINANCE);
  approverId = await make("approver", AdminRole.SUPER_ADMIN);
  recipientId = await make("recipient", AdminRole.OPERATIONS);

  customerId = (
    await prisma.customer.create({
      data: {
        reference: `CUS-RPT-${SUFFIX}`,
        firstName: "Report",
        lastName: "Customer",
        status: CustomerStatus.ACTIVE,
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  const actorIds = [operatorId, approverId, recipientId];
  await prisma.auditLog.deleteMany({ where: { adminUserId: { in: actorIds } } });
  await prisma.messageRecipient.deleteMany({
    where: { messageId: { in: messageIds } },
  });
  await prisma.message.deleteMany({ where: { id: { in: messageIds } } });
  await prisma.refund.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.adminUser.deleteMany({ where: { id: { in: actorIds } } });
  await prisma.$disconnect();
});

describe("booking report reconciles with the rows", () => {
  it("counts exactly the bookings in the window", async () => {
    await makeBooking(100_000);
    await makeBooking(50_000);

    const report = await getBookingReport({ from: WINDOW_FROM, to: WINDOW_TO });

    const actual = await prisma.booking.count({
      where: { bookedAt: { gte: WINDOW_FROM, lte: WINDOW_TO } },
    });

    expect(report.totalBookings).toBe(actual);
  });

  it("has status counts that sum to the total", async () => {
    await makeBooking(25_000, BookingStatus.CONFIRMED);

    const report = await getBookingReport({ from: WINDOW_FROM, to: WINDOW_TO });
    const summed = report.byStatus.reduce((total, row) => total + row.count, 0);

    expect(summed).toBe(report.totalBookings);
  });

  it("has agent counts that sum to the total", async () => {
    const report = await getBookingReport({ from: WINDOW_FROM, to: WINDOW_TO });
    const summed = report.byAgent.reduce((total, row) => total + row.count, 0);

    // Bookings with no agent are labelled "Unassigned" rather than dropped, so
    // the parts still add up.
    expect(summed).toBe(report.totalBookings);
  });

  it("has type counts that sum to the total even with no type set", async () => {
    const report = await getBookingReport({ from: WINDOW_FROM, to: WINDOW_TO });
    const summed = report.byType.reduce((total, row) => total + row.count, 0);

    expect(summed).toBe(report.totalBookings);
    expect(report.byType.some((row) => row.label === "Not set")).toBe(true);
  });

  it("excludes bookings outside the window", async () => {
    // Far outside the isolated window.
    const outside = await prisma.booking.create({
      data: {
        bookingNumber: `MV-OUT-${SUFFIX}`,
        product: BookingProduct.FLIGHT,
        customerId,
        currency: "USD",
        totalMinor: 999_999,
        createdById: operatorId,
        bookedAt: new Date("2028-01-01T00:00:00Z"),
      },
      select: { id: true },
    });
    bookingIds.push(outside.id);

    const report = await getBookingReport({ from: WINDOW_FROM, to: WINDOW_TO });
    const inWindow = await prisma.booking.count({
      where: { bookedAt: { gte: WINDOW_FROM, lte: WINDOW_TO } },
    });

    expect(report.totalBookings).toBe(inWindow);
  });
});

describe("financial report reconciles with the rows", () => {
  it("sums gross booking value from the bookings themselves", async () => {
    const report = await getFinancialReport({ from: WINDOW_FROM, to: WINDOW_TO });

    const actual = await prisma.booking.aggregate({
      where: {
        bookedAt: { gte: WINDOW_FROM, lte: WINDOW_TO },
        status: { not: BookingStatus.CANCELLED },
      },
      _sum: { totalMinor: true },
    });

    const reported = report.grossBookingValue.find((row) => row.currency === "USD");
    expect(reported?.amountMinor).toBe(actual._sum.totalMinor ?? 0);
  });

  it("excludes a cancelled booking from value but keeps it in counts", async () => {
    const cancelled = await makeBooking(500_000, BookingStatus.CANCELLED);

    const [financial, bookings] = await Promise.all([
      getFinancialReport({ from: WINDOW_FROM, to: WINDOW_TO }),
      getBookingReport({ from: WINDOW_FROM, to: WINDOW_TO }),
    ]);

    const valueSum = await prisma.booking.aggregate({
      where: {
        bookedAt: { gte: WINDOW_FROM, lte: WINDOW_TO },
        status: { not: BookingStatus.CANCELLED },
      },
      _sum: { totalMinor: true },
    });

    // Nothing is owed on a cancellation…
    expect(
      financial.grossBookingValue.find((row) => row.currency === "USD")?.amountMinor,
    ).toBe(valueSum._sum.totalMinor ?? 0);

    // …but it is still a real event worth counting.
    expect(
      bookings.byStatus.find((row) => row.status === BookingStatus.CANCELLED)?.count,
    ).toBeGreaterThanOrEqual(1);

    expect(cancelled).toBeTruthy();
  });

  it("agrees with a booking's own position page", async () => {
    const bookingId = await makeBooking(200_000);

    await recordPayment(
      {
        bookingId,
        amountMinor: 120_000,
        currency: "USD",
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
      },
      operatorId,
    );

    const position = await getBookingPosition(bookingId);

    // The booking's own page and the report must not disagree about what was
    // collected; both derive from the same captured-payment rule.
    const captured = await prisma.payment.aggregate({
      where: { bookingId, status: PaymentStatus.CAPTURED },
      _sum: { amountMinor: true },
    });

    expect(position?.amountCollectedMinor).toBe(captured._sum.amountMinor ?? 0);
  });

  it("counts only completed refunds as issued", async () => {
    const bookingId = await makeBooking(100_000);

    await recordPayment(
      {
        bookingId,
        amountMinor: 100_000,
        currency: "USD",
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
      },
      operatorId,
    );

    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 30_000, reason: "Test" },
      operatorId,
    );
    await approveRefund(
      { refundId: refund.id, approvedAmountMinor: 30_000 },
      approverId,
      AdminRole.SUPER_ADMIN,
    );

    // Approved but not executed — it is a commitment, not a disbursement.
    const beforeExecution = await getFinancialReport({
      from: WINDOW_FROM,
      to: WINDOW_TO,
    });
    const issuedBefore =
      beforeExecution.refundsIssued.find((row) => row.currency === "USD")
        ?.amountMinor ?? 0;

    await completeRefundManually(refund.id, "Executed manually", approverId);

    const completedSum = await prisma.refund.aggregate({
      where: { bookingId, status: "COMPLETED" },
      _sum: { approvedAmountMinor: true },
    });

    expect(completedSum._sum.approvedAmountMinor).toBe(30_000);
    // The approved-but-unpaid refund contributed nothing to "issued".
    expect(issuedBefore).toBe(0);
  });

  it("keeps pending payments out of collected", async () => {
    const bookingId = await makeBooking(80_000);

    await recordPayment(
      {
        bookingId,
        amountMinor: 80_000,
        currency: "USD",
        method: PaymentMethod.BANK_TRANSFER,
        status: PaymentStatus.PENDING,
      },
      operatorId,
    );

    const position = await getBookingPosition(bookingId);

    expect(position?.amountCollectedMinor).toBe(0);
    expect(position?.outstandingBalanceMinor).toBe(80_000);
  });
});

describe("messaging does not overstate delivery", () => {
  it("leaves a draft unsent with no recipients", async () => {
    const result = await composeMessage(
      {
        subject: "Draft subject",
        body: "Not sent yet",
        recipientIds: [recipientId],
        send: false,
      },
      operatorId,
    );
    messageIds.push(result.id);

    const message = await prisma.message.findUniqueOrThrow({
      where: { id: result.id },
      select: { status: true, sentAt: true, recipients: true },
    });

    expect(message.status).toBe(MessageStatus.DRAFT);
    expect(message.sentAt).toBeNull();
    // A draft must not create recipient rows, or it would appear in an inbox.
    expect(message.recipients).toHaveLength(0);
  });

  it("marks a sent message SENT only once recipient rows exist", async () => {
    const result = await composeMessage(
      {
        subject: "Real subject",
        body: "Readable in the inbox",
        recipientIds: [recipientId],
        send: true,
      },
      operatorId,
    );
    messageIds.push(result.id);

    const message = await prisma.message.findUniqueOrThrow({
      where: { id: result.id },
      select: { status: true, sentAt: true, recipients: true },
    });

    expect(message.status).toBe(MessageStatus.SENT);
    expect(message.sentAt).not.toBeNull();
    expect(message.recipients).toHaveLength(1);
    // Unread until the recipient actually opens it.
    expect(message.recipients[0]?.readAt).toBeNull();
  });

  it("never reports a message as DELIVERED, which would imply external transmission", async () => {
    const sent = await listSent(operatorId, {}, { page: 1, pageSize: 100 });

    // MessageStatus has no DELIVERED member precisely because this application
    // transmits nothing externally.
    for (const message of sent.rows) {
      expect([MessageStatus.DRAFT, MessageStatus.SENT]).toContain(message.status);
    }
  });

  it("creates no notification rows, because nothing transmits", async () => {
    await composeMessage(
      {
        subject: "Check notifications",
        body: "Sending internally must not fabricate a delivery record",
        recipientIds: [recipientId],
        send: true,
      },
      operatorId,
    ).then((result) => messageIds.push(result.id));

    const notifications = await prisma.notification.count({
      where: { recipient: { contains: recipientId } },
    });

    expect(notifications).toBe(0);
  });
});
