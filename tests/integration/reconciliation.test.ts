import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  BookingProduct,
  ChargebackStatus,
  CustomerStatus,
  PaymentMethod,
  PaymentStatus,
  RefundKind,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import {
  DuplicatePaymentError,
  PaymentCurrencyMismatchError,
  getBookingPosition,
  recordPayment,
} from "@/server/services/payment-service";
import {
  createChargeback,
  updateChargebackStatus,
} from "@/server/services/chargeback-service";
import {
  approveRefund,
  completeRefundManually,
  requestRefund,
} from "@/server/services/refund-service";

/**
 * Reconciliation.
 *
 * Phase 4's completion criterion is that financial records reconcile with
 * booking records. Each case below walks a booking through a realistic sequence
 * and checks the derived position against what the rows actually say.
 */

const SUFFIX = Date.now();
let operatorId: string;
let approverId: string;
let customerId: string;
const bookingIds: string[] = [];

async function makeBooking(totalMinor: number, currency = "USD"): Promise<string> {
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `MV-REC-${SUFFIX}-${bookingIds.length}`,
      product: BookingProduct.FLIGHT,
      customerId,
      currency,
      totalMinor,
      supplierCostMinor: Math.round(totalMinor * 0.9),
      grossMcoMinor: totalMinor,
      netMcoMinor: Math.round(totalMinor * 0.9),
      createdById: operatorId,
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
          email: `recon-${slug}-${SUFFIX}@example.invalid`,
          name: `Recon ${slug}`,
          passwordHash: await hashPassword("irrelevant-for-these-tests"),
          role,
        },
        select: { id: true },
      })
    ).id;

  operatorId = await make("operator", AdminRole.FINANCE);
  approverId = await make("approver", AdminRole.SUPER_ADMIN);

  customerId = (
    await prisma.customer.create({
      data: {
        reference: `CUS-REC-${SUFFIX}`,
        firstName: "Recon",
        lastName: "Customer",
        status: CustomerStatus.ACTIVE,
        email: `recon-customer-${SUFFIX}@example.invalid`,
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  const actorIds = [operatorId, approverId];
  await prisma.auditLog.deleteMany({ where: { adminUserId: { in: actorIds } } });
  await prisma.chargeback.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.refund.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.adminUser.deleteMany({ where: { id: { in: actorIds } } });
  await prisma.$disconnect();
});

describe("the position reconciles with the rows", () => {
  it("reports an unpaid booking as fully outstanding", async () => {
    const bookingId = await makeBooking(102_997);
    const position = await getBookingPosition(bookingId);

    expect(position?.grossBookingValueMinor).toBe(102_997);
    expect(position?.amountCollectedMinor).toBe(0);
    expect(position?.outstandingBalanceMinor).toBe(102_997);
    expect(position?.isFullyPaid).toBe(false);
  });

  it("does not count a pending payment as collected", async () => {
    const bookingId = await makeBooking(100_000);

    await recordPayment(
      {
        bookingId,
        amountMinor: 100_000,
        currency: "USD",
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.PENDING,
      },
      operatorId,
    );

    const position = await getBookingPosition(bookingId);

    // The row exists, but no money arrived.
    expect(position?.amountCollectedMinor).toBe(0);
    expect(position?.outstandingBalanceMinor).toBe(100_000);
  });

  it("does not count an authorisation as collected", async () => {
    const bookingId = await makeBooking(100_000);

    await recordPayment(
      {
        bookingId,
        amountMinor: 100_000,
        currency: "USD",
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.AUTHORIZED,
      },
      operatorId,
    );

    const position = await getBookingPosition(bookingId);

    expect(position?.amountAuthorizedMinor).toBe(100_000);
    expect(position?.amountCollectedMinor).toBe(0);
  });

  it("reconciles a part-paid booking across several captures", async () => {
    const bookingId = await makeBooking(100_000);

    for (const amount of [40_000, 35_000]) {
      await recordPayment(
        {
          bookingId,
          amountMinor: amount,
          currency: "USD",
          method: PaymentMethod.CREDIT_CARD,
          status: PaymentStatus.CAPTURED,
        },
        operatorId,
      );
    }

    const position = await getBookingPosition(bookingId);

    expect(position?.amountCollectedMinor).toBe(75_000);
    expect(position?.outstandingBalanceMinor).toBe(25_000);

    // Cross-check against the rows themselves rather than trusting the helper.
    const captured = await prisma.payment.aggregate({
      where: { bookingId, status: PaymentStatus.CAPTURED },
      _sum: { amountMinor: true },
    });
    expect(captured._sum.amountMinor).toBe(position?.amountCollectedMinor);
  });

  it("reconciles the full lifecycle: charge, collect, refund", async () => {
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
      {
        bookingId,
        kind: RefundKind.REFUND,
        requestedAmountMinor: 35_000,
        reason: "Schedule change",
      },
      operatorId,
    );
    await approveRefund(
      { refundId: refund.id, approvedAmountMinor: 35_000 },
      approverId,
      AdminRole.SUPER_ADMIN,
    );
    await completeRefundManually(refund.id, "Done at the desk", approverId);

    const position = await getBookingPosition(bookingId);

    expect(position?.grossBookingValueMinor).toBe(100_000);
    expect(position?.amountCollectedMinor).toBe(100_000);
    expect(position?.amountRefundedMinor).toBe(35_000);
    expect(position?.netCollectedMinor).toBe(65_000);
    expect(position?.outstandingBalanceMinor).toBe(35_000);
    expect(position?.refundableAmountMinor).toBe(65_000);
  });

  it("does not count an approved-but-unexecuted refund as issued", async () => {
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
      { bookingId, kind: RefundKind.REFUND, requestedAmountMinor: 20_000, reason: "Pending" },
      operatorId,
    );
    await approveRefund(
      { refundId: refund.id, approvedAmountMinor: 20_000 },
      approverId,
      AdminRole.SUPER_ADMIN,
    );

    const position = await getBookingPosition(bookingId);

    // Approved is a decision, not a disbursement. The money has not left.
    expect(position?.amountRefundedMinor).toBe(0);
    expect(position?.netCollectedMinor).toBe(100_000);
  });

  it("reports an open chargeback as exposure without deducting it", async () => {
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

    await createChargeback(
      {
        bookingId,
        disputedAmountMinor: 100_000,
        reason: "Cardholder does not recognise the charge",
        receivedAt: new Date(),
      },
      operatorId,
    );

    const position = await getBookingPosition(bookingId);

    expect(position?.amountDisputedMinor).toBe(100_000);
    // Still ours while the dispute is live.
    expect(position?.amountCollectedMinor).toBe(100_000);
  });

  it("stops counting a won chargeback as exposure", async () => {
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

    const chargeback = await createChargeback(
      {
        bookingId,
        disputedAmountMinor: 100_000,
        reason: "Disputed",
        receivedAt: new Date(),
      },
      operatorId,
    );

    for (const status of [
      ChargebackStatus.EVIDENCE_REQUIRED,
      ChargebackStatus.EVIDENCE_SUBMITTED,
      ChargebackStatus.UNDER_REVIEW,
      ChargebackStatus.WON,
    ]) {
      await updateChargebackStatus(
        { chargebackId: chargeback.id, status },
        operatorId,
      );
    }

    const position = await getBookingPosition(bookingId);
    expect(position?.amountDisputedMinor).toBe(0);

    const stored = await prisma.chargeback.findUniqueOrThrow({
      where: { id: chargeback.id },
      select: { outcomeAmountMinor: true, resolvedAt: true },
    });
    // Winning costs nothing.
    expect(stored.outcomeAmountMinor).toBe(0);
    expect(stored.resolvedAt).not.toBeNull();
  });

  it("records a lost chargeback as a negative outcome", async () => {
    const bookingId = await makeBooking(100_000);

    const chargeback = await createChargeback(
      {
        bookingId,
        disputedAmountMinor: 100_000,
        reason: "Disputed",
        receivedAt: new Date(),
      },
      operatorId,
    );

    for (const status of [
      ChargebackStatus.EVIDENCE_REQUIRED,
      ChargebackStatus.EVIDENCE_SUBMITTED,
      ChargebackStatus.UNDER_REVIEW,
      ChargebackStatus.LOST,
    ]) {
      await updateChargebackStatus({ chargebackId: chargeback.id, status }, operatorId);
    }

    const stored = await prisma.chargeback.findUniqueOrThrow({
      where: { id: chargeback.id },
      select: { outcomeAmountMinor: true },
    });

    expect(stored.outcomeAmountMinor).toBe(-100_000);
  });

  it("never files a prepared case with a processor", async () => {
    const bookingId = await makeBooking(100_000);

    const chargeback = await createChargeback(
      { bookingId, disputedAmountMinor: 50_000, reason: "Disputed", receivedAt: new Date() },
      operatorId,
    );

    await updateChargebackStatus(
      { chargebackId: chargeback.id, status: ChargebackStatus.EVIDENCE_REQUIRED },
      operatorId,
    );
    await updateChargebackStatus(
      { chargebackId: chargeback.id, status: ChargebackStatus.EVIDENCE_SUBMITTED },
      operatorId,
    );

    const stored = await prisma.chargeback.findUniqueOrThrow({
      where: { id: chargeback.id },
      select: { submittedAt: true, submissionReference: true },
    });

    // Internal progress is recorded; no processor reference is invented.
    expect(stored.submittedAt).not.toBeNull();
    expect(stored.submissionReference).toBeNull();
  });
});

describe("payment integrity", () => {
  it("refuses a payment in a currency other than the booking's", async () => {
    const bookingId = await makeBooking(100_000, "USD");

    await expect(
      recordPayment(
        {
          bookingId,
          amountMinor: 100_000,
          currency: "EUR",
          method: PaymentMethod.CREDIT_CARD,
          status: PaymentStatus.CAPTURED,
        },
        operatorId,
      ),
    ).rejects.toBeInstanceOf(PaymentCurrencyMismatchError);
  });

  it("refuses the same provider transaction twice", async () => {
    const bookingId = await makeBooking(100_000);

    await recordPayment(
      {
        bookingId,
        amountMinor: 50_000,
        currency: "USD",
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
        provider: "stripe",
        providerTransactionId: `pi_recon_${SUFFIX}`,
      },
      operatorId,
    );

    // The same movement of money being recorded a second time.
    await expect(
      recordPayment(
        {
          bookingId,
          amountMinor: 50_000,
          currency: "USD",
          method: PaymentMethod.CREDIT_CARD,
          status: PaymentStatus.CAPTURED,
          provider: "stripe",
          providerTransactionId: `pi_recon_${SUFFIX}`,
        },
        operatorId,
      ),
    ).rejects.toBeInstanceOf(DuplicatePaymentError);
  });

  it("returns the original payment when an idempotency key is retried", async () => {
    const bookingId = await makeBooking(100_000);
    const key = `pay-idem-${SUFFIX}`;

    const first = await recordPayment(
      {
        bookingId,
        amountMinor: 25_000,
        currency: "USD",
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
        idempotencyKey: key,
      },
      operatorId,
    );

    const second = await recordPayment(
      {
        bookingId,
        amountMinor: 25_000,
        currency: "USD",
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
        idempotencyKey: key,
      },
      operatorId,
    );

    expect(second.alreadyExisted).toBe(true);
    expect(second.id).toBe(first.id);

    // One payment, so the balance is not double-counted.
    const position = await getBookingPosition(bookingId);
    expect(position?.amountCollectedMinor).toBe(25_000);
  });

  it("always records an operator entry as manual, never provider-confirmed", async () => {
    const bookingId = await makeBooking(100_000);

    const payment = await recordPayment(
      {
        bookingId,
        amountMinor: 100_000,
        currency: "USD",
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.CAPTURED,
        // Supplying a provider name must not promote the record's provenance.
        provider: "stripe",
        providerTransactionId: `pi_claim_${SUFFIX}`,
      },
      operatorId,
    );

    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { captureMode: true },
    });

    expect(stored.captureMode).toBe("MANUAL_RECORD");
  });
});
