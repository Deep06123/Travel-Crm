import "server-only";

import {
  AuditAction,
  BookingProduct,
  BookingStatus,
  TicketStatus,
} from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/financial/money";
import { loggerFor } from "@/lib/logging/logger";
import { getBookingPosition } from "@/server/services/payment-service";

const log = loggerFor("ticketing");

/**
 * The single place a booking's ticketing state may change.
 *
 * Nothing else writes `Booking.ticketStatus`, `Booking.ticketedAt` or
 * `Passenger.ticketNumber` after creation, for the same reason the status
 * service owns `Booking.status`: the rules below are only worth having if they
 * cannot be sidestepped by a new route or form.
 *
 * Issuing a ticket is also what unlocks the CONFIRMED → TICKETED transition.
 * `checkEvidenceFor` refuses that move without an issued ticket status and a
 * ticket number on at least one passenger, so until this existed the lifecycle
 * dead-ended at CONFIRMED with no way forward.
 */

export interface IssueTicketInput {
  bookingId: string;
  actorId: string;
  /** Ticket number per passenger id. A passenger may be omitted or left blank. */
  ticketNumbers: Record<string, string>;
  /** The supplier's own reference for the issue, if there is one. */
  ticketingReference?: string | undefined;
  notes?: string | undefined;
}

export interface IssueTicketResult {
  bookingId: string;
  /** False when the ticket was already issued and nothing was written. */
  changed: boolean;
  numbered: number;
}

/** Raised when the booking is in no condition to have a ticket issued. */
export class TicketNotIssuableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TicketNotIssuableError";
  }
}

export async function issueTicket({
  bookingId,
  actorId,
  ticketNumbers,
  ticketingReference,
  notes,
}: IssueTicketInput): Promise<IssueTicketResult> {
  return prisma.$transaction(async (tx) => {
    // Read inside the transaction so a concurrent issue cannot slip between
    // the checks and the write.
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        product: true,
        status: true,
        ticketStatus: true,
        ticketedAt: true,
        airlineConfirmation: true,
        passengers: { select: { id: true, ticketNumber: true } },
      },
    });

    if (!booking) {
      throw new Error(`Booking ${bookingId} does not exist.`);
    }

    // A cruise is confirmed by the cruise line, not ticketed by an airline.
    // Recording an issued airline ticket against one would be a plain untruth.
    if (booking.product !== BookingProduct.FLIGHT) {
      throw new TicketNotIssuableError(
        "Only flight bookings are ticketed. A cruise is confirmed by the cruise line instead.",
      );
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new TicketNotIssuableError(
        "This booking is cancelled. Issuing a ticket against it would contradict its own history.",
      );
    }

    // The same evidence the TICKETED transition demands. Checked here too, so a
    // ticket cannot be marked issued against a booking the airline has not
    // confirmed — which would then satisfy that transition on false grounds.
    if (!booking.airlineConfirmation?.trim()) {
      throw new TicketNotIssuableError(
        "Record the airline or supplier confirmation reference before issuing a ticket.",
      );
    }

    if (booking.passengers.length === 0) {
      throw new TicketNotIssuableError(
        "This booking has no passengers, so there is nobody to issue a ticket to.",
      );
    }

    if (booking.ticketStatus === TicketStatus.ISSUED) {
      // Already issued: a double-submitted form is a no-op rather than an
      // error, and must not restamp `ticketedAt` to a later time than the one
      // the ticket was actually issued at.
      return { bookingId, changed: false, numbered: 0 };
    }

    // Nothing is ticketed until it is paid for. A ticket is a commitment to
    // the airline that the money behind it has been collected, so the balance
    // is checked here rather than left to whoever remembers to look at the
    // Payments panel.
    //
    // Read inside the transaction, and deliberately after the already-ISSUED
    // return above: a ticket that is already out must stay a no-op on a double
    // submit, even if the balance has since moved — a later refund does not
    // retroactively make the issue invalid.
    const position = await getBookingPosition(bookingId, tx);

    if (position && !position.isFullyPaid) {
      throw new TicketNotIssuableError(
        `This booking still has an outstanding balance of ${formatMoney(
          position.outstandingBalanceMinor,
          position.currency,
        )}. Record the payment before issuing a ticket.`,
      );
    }

    // Only numbers belonging to this booking's passengers are accepted. The
    // ids arrive from a form, and a substituted one would otherwise write a
    // ticket number onto a traveller on somebody else's booking.
    const own = new Set(booking.passengers.map((passenger) => passenger.id));

    const updates = Object.entries(ticketNumbers)
      .map(([passengerId, raw]) => ({ passengerId, number: raw.trim() }))
      .filter((entry) => entry.number !== "" && own.has(entry.passengerId));

    const alreadyNumbered = booking.passengers.filter(
      (passenger) => (passenger.ticketNumber ?? "").trim() !== "",
    ).length;

    if (updates.length === 0 && alreadyNumbered === 0) {
      throw new TicketNotIssuableError(
        "Enter a ticket number for at least one passenger.",
      );
    }

    for (const { passengerId, number } of updates) {
      await tx.passenger.update({
        where: { id: passengerId },
        data: { ticketNumber: number },
      });
    }

    const issuedAt = new Date();

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        ticketStatus: TicketStatus.ISSUED,
        ticketedAt: issuedAt,
        ...(ticketingReference?.trim()
          ? { ticketingReference: ticketingReference.trim() }
          : {}),
        ...(notes?.trim() ? { ticketingNotes: notes.trim() } : {}),
      },
    });

    // Passing `tx` ties the entry to this transaction: if the write rolls
    // back, the entry goes with it rather than claiming an issue that never
    // happened. Ticket numbers themselves are not recorded in the summary —
    // they identify a traveller's document and the audit log is widely read.
    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Booking",
        entityId: bookingId,
        adminUserId: actorId,
        summary: `Ticket issued for ${updates.length || alreadyNumbered} passenger(s)`,
        changes: {
          ticketStatus: {
            before: booking.ticketStatus,
            after: TicketStatus.ISSUED,
          },
        },
      },
      tx,
    );

    log.info(
      { bookingId, actorId, numbered: updates.length },
      "Ticket issued",
    );

    return { bookingId, changed: true, numbered: updates.length };
  });
}
