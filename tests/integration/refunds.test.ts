import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  BookingProduct,
  CustomerStatus,
  PaymentMethod,
  PaymentStatus,
  RefundKind,
  RefundStatus,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { RefundExceedsCollectedError } from "@/lib/financial/booking-balance";
import {
  ApprovalThresholdError,
  InvalidRefundTransitionError,
  SelfApprovalError,
} from "@/lib/financial/refund-rules";
import { getBookingPosition, recordPayment } from "@/server/services/payment-service";
import {
  approveRefund,
  completeRefundManually,
  rejectRefund,
  requestRefund,
} from "@/server/services/refund-service";

/**
 * Refunds against the real database.
 *
 * The plan's Phase 4 completion criterion is that refunds cannot be duplicated
 * through concurrent requests or repeated submissions. Both are tested here
 * against real Postgres — a mock could not exercise the row lock that makes
 * the concurrent case safe.
 */

const SUFFIX = Date.now();
let requesterId: string;
let approverId: string;
let financeId: string;
let customerId: string;
const bookingIds: string[] = [];

/** Creates a booking with `collectedMinor` already captured against it. */
async function bookingWithPayment(collectedMinor = 100_000): Promise<string> {
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `MV-RFD-${SUFFIX}-${bookingIds.length}`,
      product: BookingProduct.FLIGHT,
      customerId,
      currency: "USD",
      totalMinor: collectedMinor,
      supplierCostMinor: Math.round(collectedMinor * 0.9),
      grossMcoMinor: collectedMinor,
      netMcoMinor: Math.round(collectedMinor * 0.9),
      createdById: requesterId,
    },
    select: { id: true },
  });

  bookingIds.push(booking.id);

  if (collectedMinor > 0) {
    await recordPayment(
      {
        bookingId: booking.id,
        amountMinor: collectedMinor,
        currency: "USD",
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
      },
      requesterId,
    );
  }

  return booking.id;
}

beforeAll(async () => {
  const make = async (slug: string, role: AdminRole) =>
    (
      await prisma.adminUser.create({
        data: {
          email: `refund-${slug}-${SUFFIX}@example.invalid`,
          name: `Refund ${slug}`,
          passwordHash: await hashPassword("irrelevant-for-these-tests"),
          role,
        },
        select: { id: true },
      })
    ).id;

  requesterId = await make("requester", AdminRole.OPERATIONS);
  approverId = await make("approver", AdminRole.SUPER_ADMIN);
  financeId = await make("finance", AdminRole.FINANCE);

  customerId = (
    await prisma.customer.create({
      data: {
        reference: `CUS-RFD-${SUFFIX}`,
        firstName: "Refund",
        lastName: "Customer",
        email: `refund-customer-${SUFFIX}@example.invalid`,
        status: CustomerStatus.ACTIVE,
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  const actorIds = [requesterId, approverId, financeId];

  // Financial rows use onDelete: Restrict precisely so a booking cannot take
  // its payment and refund history down with it. Teardown therefore has to
  // remove them explicitly, innermost first — the constraint is the feature.
  await prisma.auditLog.deleteMany({ where: { adminUserId: { in: actorIds } } });
  await prisma.refund.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.adminUser.deleteMany({ where: { id: { in: actorIds } } });
  await prisma.$disconnect();
});

describe("duplicate prevention", () => {
  it("returns the original refund when the same idempotency key is retried", async () => {
    const bookingId = await bookingWithPayment();
    const key = `idem-${SUFFIX}-retry`;

    const first = await requestRefund(
      {
        bookingId,
        kind: RefundKind.REFUND,
        requestedAmountMinor: 50_000,
        reason: "Customer cancelled",
        idempotencyKey: key,
      },
      requesterId,
    );

    const second = await requestRefund(
      {
        bookingId,
        kind: RefundKind.REFUND,
        requestedAmountMinor: 50_000,
        reason: "Customer cancelled",
        idempotencyKey: key,
      },
      requesterId,
    );

    expect(first.alreadyExisted).toBe(false);
    expect(second.alreadyExisted).toBe(true);
    expect(second.id).toBe(first.id);

    // One refund row, not two.
    const count = await prisma.refund.count({ where: { bookingId } });
    expect(count).toBe(1);
  });

  it("does not let two concurrent requests each take the full balance", async () => {
    const bookingId = await bookingWithPayment(100_000);

    // Both ask for the entire collected amount at the same moment. Without the
    // row lock both would read a 1,000.00 balance and both would succeed.
    const results = await Promise.allSettled([
      requestRefund(
        {
          bookingId,
          kind: RefundKind.REFUND,
          requestedAmountMinor: 100_000,
          reason: "Concurrent A",
        },
        requesterId,
      ),
      requestRefund(
        {
          bookingId,
          kind: RefundKind.REFUND,
          requestedAmountMinor: 100_000,
          reason: "Concurrent B",
        },
        requesterId,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const refunds = await prisma.refund.findMany({ where: { bookingId } });
    expect(refunds).toHaveLength(1);

    // The total claimed never exceeds what was collected.
    const claimed = refunds.reduce((sum, r) => sum + r.requestedAmountMinor, 0);
    expect(claimed).toBeLessThanOrEqual(100_000);
  });

  it("holds the line across many simultaneous requests", async () => {
    const bookingId = await bookingWithPayment(100_000);

    // Ten requests for a quarter of the balance each: at most four may stand.
    const attempts = Array.from({ length: 10 }, (_, index) =>
      requestRefund(
        {
          bookingId,
          kind: RefundKind.REFUND,
          requestedAmountMinor: 25_000,
          reason: `Burst ${index}`,
        },
        requesterId,
      ),
    );

    await Promise.allSettled(attempts);

    const refunds = await prisma.refund.findMany({ where: { bookingId } });
    const claimed = refunds.reduce((sum, r) => sum + r.requestedAmountMinor, 0);

    expect(claimed).toBeLessThanOrEqual(100_000);
    expect(refunds.length).toBeLessThanOrEqual(4);
  });

  it("counts an in-flight refund against the available balance", async () => {
    const bookingId = await bookingWithPayment(100_000);

    await requestRefund(
      {
        bookingId,
        kind: RefundKind.REFUND,
        requestedAmountMinor: 60_000,
        reason: "First",
      },
      requesterId,
    );

    // Only 40,000 remains unclaimed, so 50,000 must be refused.
    await expect(
      requestRefund(
        {
          bookingId,
          kind: RefundKind.REFUND,
          requestedAmountMinor: 50_000,
          reason: "Second",
        },
        requesterId,
      ),
    ).rejects.toBeInstanceOf(RefundExceedsCollectedError);
  });
});

describe("refund amount rules", () => {
  it("refuses a refund larger than what was collected", async () => {
    const bookingId = await bookingWithPayment(50_000);

    await expect(
      requestRefund(
        {
          bookingId,
          kind: RefundKind.REFUND,
          requestedAmountMinor: 60_000,
          reason: "Too much",
        },
        requesterId,
      ),
    ).rejects.toBeInstanceOf(RefundExceedsCollectedError);
  });

  it("refuses any refund when nothing was collected", async () => {
    const bookingId = await bookingWithPayment(0);

    await expect(
      requestRefund(
        {
          bookingId,
          kind: RefundKind.REFUND,
          requestedAmountMinor: 1_000,
          reason: "Nothing collected",
        },
        requesterId,
      ),
    ).rejects.toBeInstanceOf(RefundExceedsCollectedError);
  });

  it("refuses a zero or negative amount", async () => {
    const bookingId = await bookingWithPayment();

    await expect(
      requestRefund(
        { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 0, reason: "Zero" },
        requesterId,
      ),
    ).rejects.toThrow();

    await expect(
      requestRefund(
        { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: -500, reason: "Negative" },
        requesterId,
      ),
    ).rejects.toThrow();
  });
});

describe("approval", () => {
  it("refuses approval by the person who requested it", async () => {
    const bookingId = await bookingWithPayment();
    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 10_000, reason: "Self" },
      requesterId,
    );

    await expect(
      approveRefund(
        { refundId: refund.id, approvedAmountMinor: 10_000 },
        requesterId,
        AdminRole.OPERATIONS,
      ),
    ).rejects.toBeInstanceOf(SelfApprovalError);
  });

  it("refuses an approval above the threshold from a non-super-admin", async () => {
    const bookingId = await bookingWithPayment(100_000);
    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 60_000, reason: "Large" },
      requesterId,
    );

    // The seeded threshold is 50,000 minor units.
    await expect(
      approveRefund(
        { refundId: refund.id, approvedAmountMinor: 60_000 },
        financeId,
        AdminRole.FINANCE,
      ),
    ).rejects.toBeInstanceOf(ApprovalThresholdError);
  });

  it("allows a super administrator above the threshold", async () => {
    const bookingId = await bookingWithPayment(100_000);
    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 60_000, reason: "Large" },
      requesterId,
    );

    await approveRefund(
      { refundId: refund.id, approvedAmountMinor: 60_000 },
      approverId,
      AdminRole.SUPER_ADMIN,
    );

    const stored = await prisma.refund.findUniqueOrThrow({
      where: { id: refund.id },
      select: { status: true, approvedAmountMinor: true, approvedById: true },
    });

    expect(stored.status).toBe(RefundStatus.APPROVED);
    expect(stored.approvedAmountMinor).toBe(60_000);
    expect(stored.approvedById).toBe(approverId);
  });

  it("allows finance below the threshold", async () => {
    const bookingId = await bookingWithPayment(100_000);
    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 20_000, reason: "Small" },
      requesterId,
    );

    await approveRefund(
      { refundId: refund.id, approvedAmountMinor: 20_000 },
      financeId,
      AdminRole.FINANCE,
    );

    const stored = await prisma.refund.findUniqueOrThrow({
      where: { id: refund.id },
      select: { status: true },
    });

    expect(stored.status).toBe(RefundStatus.APPROVED);
  });

  it("refuses to approve more than was requested", async () => {
    const bookingId = await bookingWithPayment(100_000);
    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 10_000, reason: "Creep" },
      requesterId,
    );

    await expect(
      approveRefund(
        { refundId: refund.id, approvedAmountMinor: 20_000 },
        approverId,
        AdminRole.SUPER_ADMIN,
      ),
    ).rejects.toThrow();
  });

  it("refuses to approve an already-approved refund twice", async () => {
    const bookingId = await bookingWithPayment(100_000);
    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 10_000, reason: "Once" },
      requesterId,
    );

    await approveRefund(
      { refundId: refund.id, approvedAmountMinor: 10_000 },
      approverId,
      AdminRole.SUPER_ADMIN,
    );

    await expect(
      approveRefund(
        { refundId: refund.id, approvedAmountMinor: 10_000 },
        approverId,
        AdminRole.SUPER_ADMIN,
      ),
    ).rejects.toBeInstanceOf(InvalidRefundTransitionError);
  });

  it("records who rejected and why", async () => {
    const bookingId = await bookingWithPayment();
    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 10_000, reason: "Dubious" },
      requesterId,
    );

    await rejectRefund(refund.id, "Outside the fare rules", approverId);

    const stored = await prisma.refund.findUniqueOrThrow({
      where: { id: refund.id },
      select: { status: true, approvedById: true, decisionNote: true },
    });

    expect(stored.status).toBe(RefundStatus.REJECTED);
    expect(stored.approvedById).toBe(approverId);
    expect(stored.decisionNote).toBe("Outside the fare rules");
  });
});

describe("execution", () => {
  it("marks a completed refund as manual, with no provider reference", async () => {
    const bookingId = await bookingWithPayment(100_000);
    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 40_000, reason: "Agreed" },
      requesterId,
    );

    await approveRefund(
      { refundId: refund.id, approvedAmountMinor: 40_000 },
      approverId,
      AdminRole.SUPER_ADMIN,
    );
    await completeRefundManually(refund.id, "Processed at the airline desk", approverId);

    const stored = await prisma.refund.findUniqueOrThrow({
      where: { id: refund.id },
      select: { status: true, completedAt: true, providerRefundId: true },
    });

    expect(stored.status).toBe(RefundStatus.COMPLETED);
    expect(stored.completedAt).not.toBeNull();
    // No integration executed this, so no provider reference may be implied.
    expect(stored.providerRefundId).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Refund", entityId: refund.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.summary).toContain("manually executed");
  });

  it("reduces the refundable balance once completed", async () => {
    const bookingId = await bookingWithPayment(100_000);

    const before = await getBookingPosition(bookingId);
    expect(before?.refundableAmountMinor).toBe(100_000);

    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 30_000, reason: "Partial" },
      requesterId,
    );
    await approveRefund(
      { refundId: refund.id, approvedAmountMinor: 30_000 },
      approverId,
      AdminRole.SUPER_ADMIN,
    );
    await completeRefundManually(refund.id, "Done", approverId);

    const after = await getBookingPosition(bookingId);
    expect(after?.amountRefundedMinor).toBe(30_000);
    expect(after?.netCollectedMinor).toBe(70_000);
    expect(after?.refundableAmountMinor).toBe(70_000);
  });

  it("marks the original payment partially refunded", async () => {
    const bookingId = await bookingWithPayment(100_000);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { bookingId },
      select: { id: true },
    });

    const refund = await requestRefund(
      {
        bookingId,
        paymentId: payment.id,
        kind: RefundKind.REFUND,
        requestedAmountMinor: 25_000,
        reason: "Partial",
      },
      requesterId,
    );
    await approveRefund(
      { refundId: refund.id, approvedAmountMinor: 25_000 },
      approverId,
      AdminRole.SUPER_ADMIN,
    );
    await completeRefundManually(refund.id, "Done", approverId);

    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true },
    });

    expect(stored.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
  });

  it("marks the original payment fully refunded when the whole amount goes back", async () => {
    const bookingId = await bookingWithPayment(100_000);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { bookingId },
      select: { id: true },
    });

    const refund = await requestRefund(
      {
        bookingId,
        paymentId: payment.id,
        kind: RefundKind.REFUND,
        requestedAmountMinor: 100_000,
        reason: "Full",
      },
      requesterId,
    );
    await approveRefund(
      { refundId: refund.id, approvedAmountMinor: 100_000 },
      approverId,
      AdminRole.SUPER_ADMIN,
    );
    await completeRefundManually(refund.id, "Done", approverId);

    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true },
    });

    expect(stored.status).toBe(PaymentStatus.REFUNDED);
  });

  it("refuses to execute a refund that was never approved", async () => {
    const bookingId = await bookingWithPayment();
    const refund = await requestRefund(
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 10_000, reason: "Unapproved" },
      requesterId,
    );

    await expect(
      completeRefundManually(refund.id, "Sneaking through", approverId),
    ).rejects.toBeInstanceOf(InvalidRefundTransitionError);
  });
});
