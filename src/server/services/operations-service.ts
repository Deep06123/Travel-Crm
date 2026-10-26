import "server-only";

import {
  AuditAction,
  BookingStatus,
  type BookingPriority,
  type CallDirection,
  type CallOutcome,
  type ServiceCaseStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { diffFields, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { nextServiceCaseNumber } from "@/lib/db/references";
import {
  paginate,
  toPageRequest,
  type Paginated,
  type PaginationInput,
} from "@/lib/pagination";

/**
 * Operational modules: high-priority bookings, customer service cases, call
 * logging and the cross-booking comment feed.
 */

// --- High priority ----------------------------------------------------------

/** A booking still needing work; closed ones are not "priority" any more. */
const OPEN_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.DRAFT,
  BookingStatus.PENDING,
  BookingStatus.NEEDS_REVIEW,
  BookingStatus.CONFIRMED,
  BookingStatus.TICKETED,
];

export interface HighPriorityFilters {
  q?: string | undefined;
  priority?: BookingPriority | undefined;
  assigneeId?: string | undefined;
  overdueOnly?: boolean | undefined;
}

export async function listHighPriorityBookings(
  filters: HighPriorityFilters,
  pagination: PaginationInput,
) {
  const where: Prisma.BookingWhereInput = {
    status: { in: OPEN_BOOKING_STATUSES },
    priority: filters.priority ?? { in: ["HIGH", "URGENT"] },
  };

  if (filters.assigneeId) where.assignedAgentId = filters.assigneeId;

  if (filters.overdueOnly) {
    where.followUpAt = { lt: new Date() };
  }

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { bookingNumber: { contains: term } },
      { customer: { lastName: { contains: term } } },
      { customer: { email: { contains: term } } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      // Urgent first, then by the soonest follow-up. Nulls last so bookings
      // with a deadline outrank those without one.
      orderBy: [{ priority: "desc" }, { followUpAt: { sort: "asc", nulls: "last" } }],
      skip,
      take,
      select: {
        id: true,
        bookingNumber: true,
        status: true,
        priority: true,
        ticketStatus: true,
        currency: true,
        totalMinor: true,
        followUpAt: true,
        bookedAt: true,
        travelStartDate: true,
        customer: { select: { id: true, firstName: true, lastName: true } },
        assignedAgent: { select: { id: true, name: true } },
        followUps: {
          where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
          orderBy: { dueAt: "asc" },
          take: 1,
          select: { id: true, reason: true, dueAt: true, priority: true },
        },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}

/**
 * Changes a booking's priority.
 *
 * Priority drives which bookings staff work first, so every change is audited
 * with a reason — the plan requires the history of important priority changes
 * to be preserved.
 */
export async function setBookingPriority(
  bookingId: string,
  priority: BookingPriority,
  reason: string,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { priority: true, bookingNumber: true },
    });

    if (before.priority === priority) return;

    await tx.booking.update({ where: { id: bookingId }, data: { priority } });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Booking",
        entityId: bookingId,
        adminUserId: actorId,
        summary: `Priority on ${before.bookingNumber}: ${before.priority} → ${priority} (${reason})`,
        changes: diffFields({ priority: before.priority }, { priority }),
      },
      tx,
    );
  });
}

export async function assignBooking(
  bookingId: string,
  assignedAgentId: string | null,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { assignedAgentId: true, bookingNumber: true },
    });

    if (before.assignedAgentId === assignedAgentId) return;

    await tx.booking.update({ where: { id: bookingId }, data: { assignedAgentId } });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Booking",
        entityId: bookingId,
        adminUserId: actorId,
        summary: `Reassigned booking ${before.bookingNumber}`,
        changes: diffFields(
          { assignedAgentId: before.assignedAgentId },
          { assignedAgentId },
        ),
      },
      tx,
    );
  });
}

// --- Customer service cases -------------------------------------------------

export interface ServiceCaseInput {
  customerId: string;
  bookingId?: string | undefined;
  category: string;
  description: string;
  priority: BookingPriority;
  assignedToId?: string | undefined;
}

export async function createServiceCase(
  input: ServiceCaseInput,
  actorId: string,
): Promise<{ id: string; caseNumber: string }> {
  return prisma.$transaction(async (tx) => {
    const caseNumber = await nextServiceCaseNumber(tx);

    const serviceCase = await tx.customerServiceCase.create({
      data: {
        caseNumber,
        customerId: input.customerId,
        bookingId: input.bookingId ?? null,
        category: input.category.trim(),
        description: input.description.trim(),
        priority: input.priority,
        assignedToId: input.assignedToId ?? null,
      },
      select: { id: true, caseNumber: true },
    });

    await recordAudit(
      {
        action: AuditAction.CREATE,
        entityType: "CustomerServiceCase",
        entityId: serviceCase.id,
        adminUserId: actorId,
        summary: `Opened case ${serviceCase.caseNumber} (${input.category})`,
      },
      tx,
    );

    return serviceCase;
  });
}

export async function updateServiceCase(
  caseId: string,
  status: ServiceCaseStatus,
  resolution: string | undefined,
  assignedToId: string | null | undefined,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.customerServiceCase.findUniqueOrThrow({
      where: { id: caseId },
      select: { status: true, caseNumber: true, assignedToId: true },
    });

    const isClosing = status === "RESOLVED" || status === "CLOSED";

    await tx.customerServiceCase.update({
      where: { id: caseId },
      data: {
        status,
        resolution: resolution?.trim() || null,
        resolvedAt: isClosing ? new Date() : null,
        ...(assignedToId !== undefined ? { assignedToId } : {}),
      },
    });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "CustomerServiceCase",
        entityId: caseId,
        adminUserId: actorId,
        summary: `Case ${before.caseNumber}: ${before.status} → ${status}`,
      },
      tx,
    );
  });
}

export interface ServiceCaseFilters {
  q?: string | undefined;
  status?: ServiceCaseStatus | undefined;
  priority?: BookingPriority | undefined;
  assignedToId?: string | undefined;
}

export async function listServiceCases(
  filters: ServiceCaseFilters,
  pagination: PaginationInput,
) {
  const where: Prisma.CustomerServiceCaseWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assignedToId) where.assignedToId = filters.assignedToId;

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { caseNumber: { contains: term } },
      { category: { contains: term } },
      { description: { contains: term } },
      { customer: { lastName: { contains: term } } },
      { booking: { bookingNumber: { contains: term } } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.customerServiceCase.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      skip,
      take,
      select: {
        id: true,
        caseNumber: true,
        category: true,
        description: true,
        priority: true,
        status: true,
        resolution: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true,
        customer: { select: { id: true, firstName: true, lastName: true } },
        booking: { select: { id: true, bookingNumber: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    }),
    prisma.customerServiceCase.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}

// --- Call logging -----------------------------------------------------------

export interface CallRecordInput {
  bookingId?: string | undefined;
  customerId?: string | undefined;
  direction: CallDirection;
  outcome: CallOutcome;
  occurredAt: Date;
  durationSeconds?: number | undefined;
  notes?: string | undefined;
  followUpRequired: boolean;
  followUpAt?: Date | undefined;
}

/**
 * Logs a call.
 *
 * Entered by hand. No telephony integration exists, so nothing here is captured
 * automatically and no recording is stored — the plan notes that live capture
 * needs its own integration and a consent review first.
 */
export async function logCall(
  input: CallRecordInput,
  actorId: string,
): Promise<string> {
  const call = await prisma.callRecord.create({
    data: {
      bookingId: input.bookingId ?? null,
      customerId: input.customerId ?? null,
      agentId: actorId,
      direction: input.direction,
      outcome: input.outcome,
      occurredAt: input.occurredAt,
      durationSeconds: input.durationSeconds ?? null,
      notes: input.notes?.trim() || null,
      followUpRequired: input.followUpRequired,
      followUpAt: input.followUpAt ?? null,
    },
    select: { id: true },
  });

  return call.id;
}

export interface CallFilters {
  q?: string | undefined;
  outcome?: CallOutcome | undefined;
  direction?: CallDirection | undefined;
  agentId?: string | undefined;
  followUpRequired?: boolean | undefined;
}

export async function listCalls(filters: CallFilters, pagination: PaginationInput) {
  const where: Prisma.CallRecordWhereInput = {};

  if (filters.outcome) where.outcome = filters.outcome;
  if (filters.direction) where.direction = filters.direction;
  if (filters.agentId) where.agentId = filters.agentId;
  if (filters.followUpRequired) where.followUpRequired = true;

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { notes: { contains: term } },
      { booking: { bookingNumber: { contains: term } } },
      { customer: { lastName: { contains: term } } },
      { customer: { phone: { contains: term } } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.callRecord.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        direction: true,
        outcome: true,
        occurredAt: true,
        durationSeconds: true,
        notes: true,
        followUpRequired: true,
        followUpAt: true,
        booking: { select: { id: true, bookingNumber: true } },
        customer: { select: { id: true, firstName: true, lastName: true } },
        agent: { select: { id: true, name: true } },
      },
    }),
    prisma.callRecord.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}

// --- Comment feed -----------------------------------------------------------

export interface CommentFeedFilters {
  q?: string | undefined;
  visibility?: "INTERNAL" | "CUSTOMER_FACING" | undefined;
  withFollowUpOnly?: boolean | undefined;
}

/** Latest comments across every booking, newest first. */
export async function listLatestComments(
  filters: CommentFeedFilters,
  pagination: PaginationInput,
) {
  const where: Prisma.BookingCommentWhereInput = {};

  if (filters.visibility) where.visibility = filters.visibility;
  if (filters.withFollowUpOnly) where.followUpAt = { not: null };

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { body: { contains: term } },
      { category: { contains: term } },
      { booking: { bookingNumber: { contains: term } } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.bookingComment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        body: true,
        category: true,
        visibility: true,
        followUpAt: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
        booking: {
          select: {
            id: true,
            bookingNumber: true,
            status: true,
            customer: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.bookingComment.count({ where }),
  ]);

  return paginate(rows, total, pagination) as Paginated<(typeof rows)[number]>;
}
