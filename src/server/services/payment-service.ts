import "server-only";

import {
  AuditAction,
  ChargebackStatus,
  PaymentCaptureMode,
  PaymentStatus,
  RefundStatus,
  type PaymentMethod,
  type ReconciliationStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { diffFields, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { nextPaymentReference } from "@/lib/db/references";
import {
  computeBookingPosition,
  type BookingFinancialPosition,
} from "@/lib/financial/booking-balance";
import {
  paginate,
  toPageRequest,
  type Paginated,
  type PaginationInput,
} from "@/lib/pagination";

/**
 * Payments.
 *
 * Two rules shape everything here:
 *
 *   1. A payment is only "collected" when its status is CAPTURED. Saving a
 *      payment link or a provider reference says nothing about whether money
 *      moved, and the UI labels the difference.
 *   2. A payment typed in by an operator is MANUAL_RECORD. Only a provider
 *      callback may set PROVIDER_CONFIRMED, so the two can never be confused
 *      in reconciliation.
 */

export class DuplicatePaymentError extends Error {
  readonly existingPaymentId: string;

  constructor(existingPaymentId: string, reference: string) {
    super(`This payment has already been recorded as ${reference}.`);
    this.name = "DuplicatePaymentError";
    this.existingPaymentId = existingPaymentId;
  }
}

export class PaymentCurrencyMismatchError extends Error {
  constructor(paymentCurrency: string, bookingCurrency: string) {
    super(
      `The payment is in ${paymentCurrency} but the booking is in ${bookingCurrency}. Record it in the booking's currency, or raise an adjustment.`,
    );
    this.name = "PaymentCurrencyMismatchError";
  }
}

export interface RecordPaymentInput {
  bookingId: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  provider?: string | undefined;
  providerTransactionId?: string | undefined;
  paymentUrl?: string | undefined;
  cardLast4?: string | undefined;
  cardBrand?: string | undefined;
  failureReason?: string | undefined;
  /**
   * Caller-supplied key making the write safe to retry. The same key always
   * yields the same payment rather than a second one.
   */
  idempotencyKey?: string | undefined;
}

export async function recordPayment(
  input: RecordPaymentInput,
  actorId: string,
): Promise<{ id: string; reference: string; alreadyExisted: boolean }> {
  // Resolving an existing key before opening the transaction keeps the common
  // retry path cheap, and the unique constraint below is the real guarantee.
  if (input.idempotencyKey) {
    const existing = await prisma.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, reference: true },
    });

    if (existing) {
      return { ...existing, alreadyExisted: true };
    }
  }

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true, currency: true, customerId: true, bookingNumber: true },
    });

    if (!booking) {
      throw new Error(`Booking ${input.bookingId} does not exist.`);
    }

    // Mixing currencies on one booking would make its balance meaningless.
    if (input.currency.toUpperCase() !== booking.currency.toUpperCase()) {
      throw new PaymentCurrencyMismatchError(input.currency, booking.currency);
    }

    // A provider transaction id identifies one real movement of money. Seeing
    // it twice means the same payment is being recorded again.
    if (input.provider && input.providerTransactionId) {
      const duplicate = await tx.payment.findFirst({
        where: {
          provider: input.provider,
          providerTransactionId: input.providerTransactionId,
        },
        select: { id: true, reference: true },
      });

      if (duplicate) {
        throw new DuplicatePaymentError(duplicate.id, duplicate.reference);
      }
    }

    const reference = await nextPaymentReference(tx);

    const payment = await tx.payment.create({
      data: {
        reference,
        bookingId: booking.id,
        customerId: booking.customerId,
        amountMinor: input.amountMinor,
        currency: booking.currency,
        method: input.method,
        status: input.status,
        // Only a verified provider callback may claim provider confirmation.
        // Everything entered through the UI is a manual record.
        captureMode: PaymentCaptureMode.MANUAL_RECORD,
        provider: input.provider ?? null,
        providerTransactionId: input.providerTransactionId ?? null,
        paymentUrl: input.paymentUrl ?? null,
        cardLast4: input.cardLast4 ?? null,
        cardBrand: input.cardBrand ?? null,
        failureReason: input.failureReason ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        recordedById: actorId,
        capturedAt: input.status === PaymentStatus.CAPTURED ? new Date() : null,
      },
      select: { id: true, reference: true },
    });

    await recordAudit(
      {
        action: AuditAction.CREATE,
        entityType: "Payment",
        entityId: payment.id,
        adminUserId: actorId,
        summary: `Recorded ${input.status} payment ${payment.reference} on booking ${booking.bookingNumber}`,
      },
      tx,
    );

    return { ...payment, alreadyExisted: false };
  });
}

export async function updatePaymentStatus(
  paymentId: string,
  status: PaymentStatus,
  actorId: string,
  failureReason?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true, reference: true, capturedAt: true },
    });

    if (before.status === status) return;

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status,
        failureReason: failureReason ?? null,
        // Stamp the capture time the first time it reaches CAPTURED.
        ...(status === PaymentStatus.CAPTURED && before.capturedAt === null
          ? { capturedAt: new Date() }
          : {}),
      },
    });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Payment",
        entityId: paymentId,
        adminUserId: actorId,
        summary: `Payment ${before.reference}: ${before.status} → ${status}`,
        changes: diffFields({ status: before.status }, { status }),
      },
      tx,
    );
  });
}

export async function setReconciliationStatus(
  paymentId: string,
  status: ReconciliationStatus,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { reconciliationStatus: true, reference: true },
    });

    if (before.reconciliationStatus === status) return;

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        reconciliationStatus: status,
        reconciledAt: status === "MATCHED" ? new Date() : null,
      },
    });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Payment",
        entityId: paymentId,
        adminUserId: actorId,
        summary: `Payment ${before.reference} reconciliation: ${before.reconciliationStatus} → ${status}`,
      },
      tx,
    );
  });
}

/**
 * Computes a booking's financial position from its stored records.
 *
 * Reads payments, refunds, chargebacks and adjustments and applies the
 * definitions in `lib/financial/booking-balance`. Nothing is cached — the
 * balance is always derived, never stored, so it cannot drift from the rows
 * it summarises.
 */
export async function getBookingPosition(
  bookingId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<BookingFinancialPosition | null> {
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    select: {
      currency: true,
      totalMinor: true,
      supplierCostMinor: true,
      grossMcoMinor: true,
      netMcoMinor: true,
      payments: { select: { amountMinor: true, currency: true, status: true } },
      refunds: {
        select: {
          approvedAmountMinor: true,
          requestedAmountMinor: true,
          currency: true,
          status: true,
        },
      },
      chargebacks: {
        select: { disputedAmountMinor: true, currency: true, status: true },
      },
      adjustments: { select: { amountMinor: true, currency: true } },
    },
  });

  if (!booking) return null;

  const captured = booking.payments.filter(
    (payment) => payment.status === PaymentStatus.CAPTURED,
  );
  const authorized = booking.payments.filter(
    (payment) => payment.status === PaymentStatus.AUTHORIZED,
  );
  const completedRefunds = booking.refunds.filter(
    (refund) => refund.status === RefundStatus.COMPLETED,
  );
  const openChargebacks = booking.chargebacks.filter(
    (chargeback) =>
      chargeback.status !== ChargebackStatus.WON &&
      chargeback.status !== ChargebackStatus.LOST,
  );

  return computeBookingPosition({
    currency: booking.currency,
    grossBookingValueMinor: booking.totalMinor,
    supplierCostMinor: booking.supplierCostMinor,
    grossMcoMinor: booking.grossMcoMinor,
    netMcoMinor: booking.netMcoMinor,
    capturedPayments: captured.map((p) => ({
      amountMinor: p.amountMinor,
      currency: p.currency,
    })),
    authorizedPayments: authorized.map((p) => ({
      amountMinor: p.amountMinor,
      currency: p.currency,
    })),
    completedRefunds: completedRefunds.map((r) => ({
      // A completed refund always has an approved amount; fall back defensively.
      amountMinor: r.approvedAmountMinor ?? r.requestedAmountMinor,
      currency: r.currency,
    })),
    openChargebacks: openChargebacks.map((c) => ({
      amountMinor: c.disputedAmountMinor,
      currency: c.currency,
    })),
    adjustments: booking.adjustments.map((a) => ({
      amountMinor: a.amountMinor,
      currency: a.currency,
    })),
  });
}

export interface PaymentListFilters {
  q?: string | undefined;
  status?: PaymentStatus | undefined;
  reconciliationStatus?: ReconciliationStatus | undefined;
  method?: PaymentMethod | undefined;
  bookingId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export async function listPayments(
  filters: PaymentListFilters,
  pagination: PaginationInput,
) {
  const where: Prisma.PaymentWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.reconciliationStatus) {
    where.reconciliationStatus = filters.reconciliationStatus;
  }
  if (filters.method) where.method = filters.method;
  if (filters.bookingId) where.bookingId = filters.bookingId;

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to
        ? { lte: new Date(filters.to.getTime() + 86_400_000 - 1) }
        : {}),
    };
  }

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { reference: { contains: term } },
      { providerTransactionId: { contains: term } },
      { cardLast4: { contains: term } },
      { booking: { bookingNumber: { contains: term } } },
      { customer: { lastName: { contains: term } } },
      { customer: { email: { contains: term } } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        reference: true,
        amountMinor: true,
        currency: true,
        method: true,
        status: true,
        captureMode: true,
        provider: true,
        providerTransactionId: true,
        cardLast4: true,
        cardBrand: true,
        reconciliationStatus: true,
        failureReason: true,
        createdAt: true,
        booking: { select: { id: true, bookingNumber: true } },
        customer: { select: { id: true, firstName: true, lastName: true } },
        recordedBy: { select: { name: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}

/** Per-currency totals for the payments list header. */
export async function summarisePayments(filters: PaymentListFilters) {
  const where: Prisma.PaymentWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
  };

  const rows = await prisma.payment.groupBy({
    by: ["currency", "status"],
    where,
    _sum: { amountMinor: true },
    _count: true,
  });

  return rows.map((row) => ({
    currency: row.currency,
    status: row.status,
    amountMinor: row._sum.amountMinor ?? 0,
    count: row._count,
  }));
}
