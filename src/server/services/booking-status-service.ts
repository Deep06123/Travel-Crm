import "server-only";

import { AuditAction, BookingStatus } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import {
  InvalidTransitionError,
  MissingEvidenceError,
  ReasonRequiredError,
  checkEvidenceFor,
  isTransitionAllowed,
  requiresReason,
} from "@/lib/bookings/status";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";

const log = loggerFor("booking-status");

/**
 * The single place a booking's status may change.
 *
 * Nothing else in the application writes `Booking.status`. Centralising it is
 * what makes the transition matrix, the evidence requirements and the history
 * trail impossible to bypass from a new route or form.
 */

export interface TransitionInput {
  bookingId: string;
  toStatus: BookingStatus;
  actorId: string;
  reason?: string | undefined;
}

export interface TransitionResult {
  bookingId: string;
  fromStatus: BookingStatus;
  toStatus: BookingStatus;
}

export async function transitionBooking({
  bookingId,
  toStatus,
  actorId,
  reason,
}: TransitionInput): Promise<TransitionResult> {
  const trimmedReason = reason?.trim() || undefined;

  if (requiresReason(toStatus) && !trimmedReason) {
    throw new ReasonRequiredError(toStatus);
  }

  return prisma.$transaction(async (tx) => {
    // Read inside the transaction so a concurrent transition cannot slip
    // between the check and the write.
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        airlineConfirmation: true,
        ticketStatus: true,
        ticketedAt: true,
        passengers: { select: { ticketNumber: true } },
      },
    });

    if (!booking) {
      throw new Error(`Booking ${bookingId} does not exist.`);
    }

    const fromStatus = booking.status;

    if (fromStatus === toStatus) {
      // Re-submitting the same status is a no-op rather than an error, so a
      // double-clicked button does not produce a spurious history row.
      return { bookingId, fromStatus, toStatus };
    }

    if (!isTransitionAllowed(fromStatus, toStatus)) {
      throw new InvalidTransitionError(fromStatus, toStatus);
    }

    const evidence = checkEvidenceFor(toStatus, {
      airlineConfirmation: booking.airlineConfirmation,
      ticketStatus: booking.ticketStatus,
      ticketedAt: booking.ticketedAt,
      passengerCount: booking.passengers.length,
      hasIssuedTicketNumbers: booking.passengers.some(
        (passenger) => (passenger.ticketNumber ?? "").trim() !== "",
      ),
    });

    if (!evidence.ok) {
      throw new MissingEvidenceError(toStatus, evidence.missing);
    }

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: toStatus,
        // Stamp the ticketing date the first time a booking reaches TICKETED.
        ...(toStatus === BookingStatus.TICKETED && booking.ticketedAt === null
          ? { ticketedAt: new Date() }
          : {}),
      },
    });

    await tx.bookingStatusHistory.create({
      data: {
        bookingId,
        fromStatus,
        toStatus,
        reason: trimmedReason ?? null,
        changedById: actorId,
      },
    });

    // Passing `tx` ties the audit entry to this transaction: if the update
    // rolls back, the entry goes with it rather than claiming a change that
    // never happened.
    await recordAudit(
      {
        action: AuditAction.STATUS_CHANGE,
        entityType: "Booking",
        entityId: bookingId,
        adminUserId: actorId,
        summary: `Booking status ${fromStatus} → ${toStatus}`,
        changes: {
          status: { before: fromStatus, after: toStatus },
        },
      },
      tx,
    );

    log.info({ bookingId, fromStatus, toStatus, actorId }, "Booking status changed");

    return { bookingId, fromStatus, toStatus };
  });
}

/** Status history for a booking, newest first. */
export async function getStatusHistory(bookingId: string) {
  return prisma.bookingStatusHistory.findMany({
    where: { bookingId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      createdAt: true,
      changedBy: { select: { id: true, name: true } },
    },
  });
}
