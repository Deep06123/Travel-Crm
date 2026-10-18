import "server-only";

import {
  AdminRole,
  AuditAction,
  PaymentStatus,
  RefundKind,
  RefundStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { nextRefundReference } from "@/lib/db/references";
import { assertRefundable } from "@/lib/financial/booking-balance";
import {
  ApprovalThresholdError,
  InvalidRefundTransitionError,
  IN_FLIGHT_REFUND_STATUSES,
  SelfApprovalError,
  isRefundTransitionAllowed,
  requiresElevatedApproval,
} from "@/lib/financial/refund-rules";
import { loggerFor } from "@/lib/logging/logger";
import {
  paginate,
  toPageRequest,
  type Paginated,
  type PaginationInput,
} from "@/lib/pagination";

import { getBookingPosition } from "./payment-service";

const log = loggerFor("refund-service");

/**
 * Refunds and voids.
 *
 * The plan's hard requirement is that a refund cannot be duplicated by
 * concurrent requests or repeated submissions. Three mechanisms enforce that,
 * and all three are needed:
 *
 *   1. A unique index on `idempotencyKey` — a retried submission returns the
 *      original refund instead of creating a second.
 *   2. A row-level lock on the booking for the duration of the check-and-write,
 *      so two simultaneous requests cannot both read the same balance and both
 *      pass. This is the one that defeats genuine concurrency.
 *   3. In-flight refunds counted against the refundable balance, so a second
 *      request for the same money is refused on its merits.
 *
 * A void cancels an unsettled charge and a refund returns settled funds. They
 * are distinguished by `kind` because they carry different authorisation.
 */

const DEFAULT_APPROVAL_THRESHOLD_MINOR = 50_000;

async function approvalThresholdMinor(
  client: Prisma.TransactionClient | typeof prisma,
): Promise<number> {
  const setting = await client.businessSetting.findUnique({
    where: { key: "refund_approval_threshold_minor" },
    select: { value: true },
  });

  return typeof setting?.value === "number"
    ? setting.value
    : DEFAULT_APPROVAL_THRESHOLD_MINOR;
}

export interface RequestRefundInput {
  bookingId: string;
  paymentId?: string | undefined;
  kind: RefundKind;
  requestedAmountMinor: number;
  reason: string;
  idempotencyKey?: string | undefined;
}

export interface RefundResult {
  id: string;
  reference: string;
  alreadyExisted: boolean;
}

export async function requestRefund(
  input: RequestRefundInput,
  actorId: string,
): Promise<RefundResult> {
  if (input.requestedAmountMinor <= 0) {
    throw new Error("A refund amount must be greater than zero.");
  }

  if (input.idempotencyKey) {
    const existing = await prisma.refund.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, reference: true },
    });

    if (existing) return { ...existing, alreadyExisted: true };
  }

  return prisma.$transaction(async (tx) => {
    // Serialise concurrent refund requests for this booking. Without the lock,
    // two requests can both read a 1,000.00 balance and both be accepted for
    // 1,000.00 — the classic double-refund. The lock is taken before any
    // balance is read, and held until commit.
    await tx.$executeRaw`SELECT id FROM "Booking" WHERE id = ${input.bookingId} FOR UPDATE`;

    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true, bookingNumber: true, currency: true },
    });

    if (!booking) {
      throw new Error(`Booking ${input.bookingId} does not exist.`);
    }

    if (input.paymentId) {
      const payment = await tx.payment.findUnique({
        where: { id: input.paymentId },
        select: { id: true, bookingId: true, status: true, amountMinor: true },
      });

      if (!payment || payment.bookingId !== booking.id) {
        throw new Error("That payment does not belong to this booking.");
      }

      // Refunding a payment that never captured would return money that was
      // never taken.
      if (
        payment.status !== PaymentStatus.CAPTURED &&
        payment.status !== PaymentStatus.PARTIALLY_REFUNDED
      ) {
        throw new Error(
          `Payment is ${payment.status}; only a captured payment can be refunded.`,
        );
      }
    }

    const position = await getBookingPosition(booking.id, tx);
    if (!position) throw new Error("Could not compute the booking balance.");

    // Refunds already raised but not yet completed still lay claim to this
    // money, so they count against what is available.
    const inFlight = await tx.refund.aggregate({
      where: {
        bookingId: booking.id,
        status: { in: [...IN_FLIGHT_REFUND_STATUSES] },
      },
      _sum: { requestedAmountMinor: true },
    });

    assertRefundable(
      input.requestedAmountMinor,
      position,
      inFlight._sum.requestedAmountMinor ?? 0,
    );

    const reference = await nextRefundReference(tx);

    const refund = await tx.refund.create({
      data: {
        reference,
        kind: input.kind,
        bookingId: booking.id,
        paymentId: input.paymentId ?? null,
        requestedAmountMinor: input.requestedAmountMinor,
        currency: booking.currency,
        reason: input.reason,
        status: RefundStatus.PENDING,
        requestedById: actorId,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: { id: true, reference: true },
    });

    await recordAudit(
      {
        action: AuditAction.CREATE,
        entityType: "Refund",
        entityId: refund.id,
        adminUserId: actorId,
        summary: `Requested ${input.kind} ${refund.reference} on booking ${booking.bookingNumber}`,
      },
      tx,
    );

    log.info(
      { refundId: refund.id, bookingId: booking.id, actorId },
      "Refund requested",
    );

    return { ...refund, alreadyExisted: false };
  });
}

export interface ApproveRefundInput {
  refundId: string;
  approvedAmountMinor: number;
  decisionNote?: string | undefined;
}

/**
 * Approves a refund.
 *
 * The approver must be a different person from the requester, and amounts at or
 * above the configured threshold require a SUPER_ADMIN.
 */
export async function approveRefund(
  { refundId, approvedAmountMinor, decisionNote }: ApproveRefundInput,
  actorId: string,
  actorRole: AdminRole,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: {
        id: true,
        reference: true,
        status: true,
        bookingId: true,
        currency: true,
        requestedAmountMinor: true,
        requestedById: true,
      },
    });

    if (!isRefundTransitionAllowed(refund.status, RefundStatus.APPROVED)) {
      throw new InvalidRefundTransitionError(refund.status, RefundStatus.APPROVED);
    }

    // Separation of duties: raising and approving the same refund would let one
    // person move money out unchecked.
    if (refund.requestedById === actorId) {
      throw new SelfApprovalError();
    }

    if (approvedAmountMinor <= 0) {
      throw new Error("An approved amount must be greater than zero.");
    }

    // Approving more than was asked for would bypass the request's own review.
    if (approvedAmountMinor > refund.requestedAmountMinor) {
      throw new Error(
        "The approved amount cannot exceed the amount that was requested.",
      );
    }

    const threshold = await approvalThresholdMinor(tx);

    if (
      requiresElevatedApproval(approvedAmountMinor, threshold) &&
      actorRole !== AdminRole.SUPER_ADMIN
    ) {
      throw new ApprovalThresholdError(
        approvedAmountMinor,
        threshold,
        refund.currency,
      );
    }

    // Re-check against the live balance: the position may have moved between
    // the request and this decision.
    await tx.$executeRaw`SELECT id FROM "Booking" WHERE id = ${refund.bookingId} FOR UPDATE`;

    const position = await getBookingPosition(refund.bookingId, tx);
    if (!position) throw new Error("Could not compute the booking balance.");

    const otherInFlight = await tx.refund.aggregate({
      where: {
        bookingId: refund.bookingId,
        status: { in: [...IN_FLIGHT_REFUND_STATUSES] },
        id: { not: refund.id },
      },
      _sum: { requestedAmountMinor: true },
    });

    assertRefundable(
      approvedAmountMinor,
      position,
      otherInFlight._sum.requestedAmountMinor ?? 0,
    );

    await tx.refund.update({
      where: { id: refundId },
      data: {
        status: RefundStatus.APPROVED,
        approvedAmountMinor,
        approvedById: actorId,
        approvedAt: new Date(),
        decisionNote: decisionNote ?? null,
      },
    });

    await recordAudit(
      {
        action: AuditAction.APPROVE,
        entityType: "Refund",
        entityId: refundId,
        adminUserId: actorId,
        summary: `Approved refund ${refund.reference} for ${approvedAmountMinor} minor units`,
      },
      tx,
    );
  });
}

export async function rejectRefund(
  refundId: string,
  decisionNote: string,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: { status: true, reference: true, requestedById: true },
    });

    if (!isRefundTransitionAllowed(refund.status, RefundStatus.REJECTED)) {
      throw new InvalidRefundTransitionError(refund.status, RefundStatus.REJECTED);
    }

    if (refund.requestedById === actorId) {
      throw new SelfApprovalError();
    }

    await tx.refund.update({
      where: { id: refundId },
      data: {
        status: RefundStatus.REJECTED,
        approvedById: actorId,
        approvedAt: new Date(),
        decisionNote,
      },
    });

    await recordAudit(
      {
        action: AuditAction.REJECT,
        entityType: "Refund",
        entityId: refundId,
        adminUserId: actorId,
        summary: `Rejected refund ${refund.reference}`,
      },
      tx,
    );
  });
}

/**
 * Records that an approved refund was executed.
 *
 * No provider integration exists, so this marks a MANUALLY executed refund and
 * says so in the audit trail. `providerRefundId` stays null until a real
 * integration supplies one — the record never implies the provider confirmed
 * something it did not.
 */
export async function completeRefundManually(
  refundId: string,
  note: string,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: {
        status: true,
        reference: true,
        approvedAmountMinor: true,
        paymentId: true,
        currency: true,
      },
    });

    // APPROVED → PROCESSING → COMPLETED. Going straight to COMPLETED would skip
    // the state an operator uses to see work in progress.
    if (!isRefundTransitionAllowed(refund.status, RefundStatus.PROCESSING)) {
      throw new InvalidRefundTransitionError(refund.status, RefundStatus.PROCESSING);
    }

    if (refund.approvedAmountMinor === null) {
      throw new Error("The refund has no approved amount.");
    }

    await tx.refund.update({
      where: { id: refundId },
      data: {
        status: RefundStatus.COMPLETED,
        completedAt: new Date(),
        // Deliberately not set: no provider executed this.
        providerRefundId: null,
        decisionNote: note,
      },
    });

    // Reflect the refund on the original payment, so its own status does not
    // still read as a clean capture.
    if (refund.paymentId) {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: refund.paymentId },
        select: { amountMinor: true },
      });

      const fullyRefunded = refund.approvedAmountMinor >= payment.amountMinor;

      await tx.payment.update({
        where: { id: refund.paymentId },
        data: {
          status: fullyRefunded
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED,
        },
      });
    }

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Refund",
        entityId: refundId,
        adminUserId: actorId,
        // Spelled out: this was an operator action, not a provider confirmation.
        summary: `Refund ${refund.reference} recorded as manually executed (no provider integration)`,
      },
      tx,
    );
  });
}

export interface RefundListFilters {
  q?: string | undefined;
  status?: RefundStatus | undefined;
  kind?: RefundKind | undefined;
  bookingId?: string | undefined;
}

export async function listRefunds(
  filters: RefundListFilters,
  pagination: PaginationInput,
) {
  const where: Prisma.RefundWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.kind) where.kind = filters.kind;
  if (filters.bookingId) where.bookingId = filters.bookingId;

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { reference: { contains: term, mode: "insensitive" } },
      { reason: { contains: term, mode: "insensitive" } },
      { booking: { bookingNumber: { contains: term, mode: "insensitive" } } },
      { booking: { customer: { lastName: { contains: term, mode: "insensitive" } } } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        reference: true,
        kind: true,
        status: true,
        requestedAmountMinor: true,
        approvedAmountMinor: true,
        currency: true,
        reason: true,
        decisionNote: true,
        requestedAt: true,
        approvedAt: true,
        completedAt: true,
        providerRefundId: true,
        booking: {
          select: {
            id: true,
            bookingNumber: true,
            customer: { select: { firstName: true, lastName: true } },
          },
        },
        payment: { select: { id: true, reference: true } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.refund.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}
