import "server-only";

import { AuditAction, ChargebackStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { nextChargebackReference } from "@/lib/db/references";
import {
  paginate,
  toPageRequest,
  type Paginated,
  type PaginationInput,
} from "@/lib/pagination";

/**
 * Chargebacks.
 *
 * The CRM prepares and tracks a dispute: the amount, the deadline, the evidence
 * gathered and the outcome. It does NOT submit anything to a payment processor
 * — no integration exists. `submissionReference` stays null until a real
 * submission returns one, so a prepared case is never mistaken for a filed one.
 */

/** Statuses from which a case can still move. */
const ALLOWED_TRANSITIONS: Readonly<
  Record<ChargebackStatus, readonly ChargebackStatus[]>
> = {
  [ChargebackStatus.RECEIVED]: [
    ChargebackStatus.EVIDENCE_REQUIRED,
    ChargebackStatus.ACCEPTED,
  ],
  [ChargebackStatus.EVIDENCE_REQUIRED]: [
    ChargebackStatus.EVIDENCE_SUBMITTED,
    ChargebackStatus.ACCEPTED,
  ],
  [ChargebackStatus.EVIDENCE_SUBMITTED]: [ChargebackStatus.UNDER_REVIEW],
  [ChargebackStatus.UNDER_REVIEW]: [ChargebackStatus.WON, ChargebackStatus.LOST],
  // Terminal outcomes.
  [ChargebackStatus.WON]: [],
  [ChargebackStatus.LOST]: [],
  // Accepting liability closes the case without contest.
  [ChargebackStatus.ACCEPTED]: [],
};

export function allowedChargebackTransitionsFrom(
  status: ChargebackStatus,
): readonly ChargebackStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export class InvalidChargebackTransitionError extends Error {
  constructor(from: ChargebackStatus, to: ChargebackStatus) {
    const allowed = ALLOWED_TRANSITIONS[from];
    super(
      allowed.length === 0
        ? `A ${from} chargeback is closed and cannot move to ${to}.`
        : `A chargeback cannot move from ${from} to ${to}. Allowed: ${allowed.join(", ")}.`,
    );
    this.name = "InvalidChargebackTransitionError";
  }
}

export interface CreateChargebackInput {
  bookingId: string;
  paymentId?: string | undefined;
  disputedAmountMinor: number;
  reasonCode?: string | undefined;
  reason: string;
  receivedAt: Date;
  respondBy?: Date | undefined;
  assignedToId?: string | undefined;
}

export async function createChargeback(
  input: CreateChargebackInput,
  actorId: string,
): Promise<{ id: string; reference: string }> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true, bookingNumber: true, currency: true },
    });

    if (!booking) throw new Error("That booking does not exist.");

    if (input.paymentId) {
      const payment = await tx.payment.findUnique({
        where: { id: input.paymentId },
        select: { bookingId: true },
      });

      if (!payment || payment.bookingId !== booking.id) {
        throw new Error("That payment does not belong to this booking.");
      }
    }

    const reference = await nextChargebackReference(tx);

    const chargeback = await tx.chargeback.create({
      data: {
        reference,
        bookingId: booking.id,
        paymentId: input.paymentId ?? null,
        disputedAmountMinor: input.disputedAmountMinor,
        currency: booking.currency,
        reasonCode: input.reasonCode ?? null,
        reason: input.reason,
        status: ChargebackStatus.RECEIVED,
        receivedAt: input.receivedAt,
        respondBy: input.respondBy ?? null,
        assignedToId: input.assignedToId ?? null,
      },
      select: { id: true, reference: true },
    });

    await recordAudit(
      {
        action: AuditAction.CREATE,
        entityType: "Chargeback",
        entityId: chargeback.id,
        adminUserId: actorId,
        summary: `Chargeback ${chargeback.reference} opened on booking ${booking.bookingNumber}`,
      },
      tx,
    );

    return chargeback;
  });
}

export interface UpdateChargebackStatusInput {
  chargebackId: string;
  status: ChargebackStatus;
  resolution?: string | undefined;
  outcomeAmountMinor?: number | undefined;
}

export async function updateChargebackStatus(
  { chargebackId, status, resolution, outcomeAmountMinor }: UpdateChargebackStatusInput,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.chargeback.findUniqueOrThrow({
      where: { id: chargebackId },
      select: { status: true, reference: true, disputedAmountMinor: true },
    });

    if (before.status === status) return;

    if (!ALLOWED_TRANSITIONS[before.status].includes(status)) {
      throw new InvalidChargebackTransitionError(before.status, status);
    }

    const isResolved =
      status === ChargebackStatus.WON ||
      status === ChargebackStatus.LOST ||
      status === ChargebackStatus.ACCEPTED;

    // A lost or accepted dispute costs us the disputed amount; a win costs
    // nothing. Recorded explicitly rather than inferred later from the status.
    const outcome =
      outcomeAmountMinor ??
      (status === ChargebackStatus.LOST || status === ChargebackStatus.ACCEPTED
        ? -before.disputedAmountMinor
        : status === ChargebackStatus.WON
          ? 0
          : null);

    await tx.chargeback.update({
      where: { id: chargebackId },
      data: {
        status,
        resolution: resolution ?? null,
        resolvedAt: isResolved ? new Date() : null,
        outcomeAmountMinor: isResolved ? outcome : null,
        // Only set when a real submission happens; marking evidence submitted
        // inside the CRM does not produce a processor reference.
        submittedAt:
          status === ChargebackStatus.EVIDENCE_SUBMITTED ? new Date() : undefined,
      },
    });

    await recordAudit(
      {
        action: isResolved ? AuditAction.UPDATE : AuditAction.STATUS_CHANGE,
        entityType: "Chargeback",
        entityId: chargebackId,
        adminUserId: actorId,
        summary: `Chargeback ${before.reference}: ${before.status} → ${status}`,
      },
      tx,
    );
  });
}

export async function attachEvidence(
  chargebackId: string,
  documentId: string,
  note: string | undefined,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.chargebackEvidence.create({
      data: { chargebackId, documentId, note: note ?? null },
    });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Chargeback",
        entityId: chargebackId,
        adminUserId: actorId,
        summary: "Evidence attached to chargeback",
      },
      tx,
    );
  });
}

export interface ChargebackListFilters {
  q?: string | undefined;
  status?: ChargebackStatus | undefined;
  assignedToId?: string | undefined;
  /** Only cases whose response deadline has passed and are still open. */
  overdueOnly?: boolean | undefined;
}

export async function listChargebacks(
  filters: ChargebackListFilters,
  pagination: PaginationInput,
) {
  const where: Prisma.ChargebackWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.assignedToId) where.assignedToId = filters.assignedToId;

  if (filters.overdueOnly) {
    where.respondBy = { lt: new Date() };
    where.status = {
      in: [
        ChargebackStatus.RECEIVED,
        ChargebackStatus.EVIDENCE_REQUIRED,
        ChargebackStatus.EVIDENCE_SUBMITTED,
      ],
    };
  }

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { reference: { contains: term } },
      { reason: { contains: term } },
      { reasonCode: { contains: term } },
      { booking: { bookingNumber: { contains: term } } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.chargeback.findMany({
      where,
      // Soonest deadline first: these are time-critical and a missed deadline
      // forfeits the dispute.
      orderBy: [{ respondBy: "asc" }, { receivedAt: "desc" }],
      skip,
      take,
      select: {
        id: true,
        reference: true,
        disputedAmountMinor: true,
        currency: true,
        reason: true,
        reasonCode: true,
        status: true,
        receivedAt: true,
        respondBy: true,
        submittedAt: true,
        submissionReference: true,
        resolvedAt: true,
        resolution: true,
        outcomeAmountMinor: true,
        booking: {
          select: {
            id: true,
            bookingNumber: true,
            customer: { select: { firstName: true, lastName: true } },
          },
        },
        payment: { select: { id: true, reference: true } },
        assignedTo: { select: { id: true, name: true } },
        _count: { select: { evidence: true } },
      },
    }),
    prisma.chargeback.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}
