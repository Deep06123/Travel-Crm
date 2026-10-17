import { BookingStatus, TicketStatus } from "@/generated/prisma/enums";

/**
 * Booking lifecycle rules.
 *
 * Pure logic, deliberately free of database access so the transition matrix can
 * be unit-tested exhaustively. The service in
 * `src/server/services/booking-status-service.ts` applies these rules inside a
 * transaction and writes the history row.
 *
 * Booking status answers one question only: where is this booking in its
 * lifecycle. Whether money was collected, whether a ticket was issued, and
 * whether a refund is in flight are tracked on their own fields and are never
 * inferred from this one.
 */

/** Statuses a booking in `from` may move to. */
const ALLOWED_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  // A draft is still being typed; it may be abandoned outright.
  [BookingStatus.DRAFT]: [
    BookingStatus.PENDING,
    BookingStatus.NEEDS_REVIEW,
    BookingStatus.CANCELLED,
  ],

  [BookingStatus.PENDING]: [
    BookingStatus.NEEDS_REVIEW,
    BookingStatus.CONFIRMED,
    BookingStatus.CANCELLED,
  ],

  // Review can send a booking back to pending once the query is resolved.
  [BookingStatus.NEEDS_REVIEW]: [
    BookingStatus.PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.CANCELLED,
  ],

  [BookingStatus.CONFIRMED]: [
    BookingStatus.TICKETED,
    BookingStatus.NEEDS_REVIEW,
    BookingStatus.CANCELLED,
  ],

  // A ticketed booking completes after travel, or is cancelled if the customer
  // does not travel. Cancellation does not void the ticket by itself — that is
  // a separate ticketing action with its own authorization.
  [BookingStatus.TICKETED]: [
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.NEEDS_REVIEW,
  ],

  // Terminal. Reinstating a cancelled booking means creating a new one, so the
  // cancelled record keeps its own history intact.
  [BookingStatus.CANCELLED]: [],

  // Terminal, but a post-travel dispute can reopen it for review.
  [BookingStatus.COMPLETED]: [BookingStatus.NEEDS_REVIEW],
};

export function allowedTransitionsFrom(
  status: BookingStatus,
): readonly BookingStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function isTransitionAllowed(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Statuses from which no further movement is possible. */
export function isTerminal(status: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * Evidence a booking must already carry before entering a status.
 *
 * The brief is explicit that a booking may only be marked confirmed or ticketed
 * when the supporting record exists. These are the checks; the service applies
 * them against the stored row rather than trusting the caller.
 */
export interface BookingEvidence {
  airlineConfirmation: string | null;
  ticketStatus: TicketStatus;
  ticketedAt: Date | null;
  passengerCount: number;
  hasIssuedTicketNumbers: boolean;
}

export interface EvidenceResult {
  ok: boolean;
  missing: string[];
}

export function checkEvidenceFor(
  target: BookingStatus,
  evidence: BookingEvidence,
): EvidenceResult {
  const missing: string[] = [];

  if (target === BookingStatus.CONFIRMED) {
    if (!evidence.airlineConfirmation?.trim()) {
      missing.push("an airline or supplier confirmation reference");
    }
    if (evidence.passengerCount === 0) {
      missing.push("at least one passenger");
    }
  }

  if (target === BookingStatus.TICKETED) {
    if (evidence.ticketStatus !== TicketStatus.ISSUED) {
      missing.push("ticket status set to Issued");
    }
    if (!evidence.hasIssuedTicketNumbers) {
      missing.push("a ticket number on at least one passenger");
    }
    if (!evidence.airlineConfirmation?.trim()) {
      missing.push("an airline or supplier confirmation reference");
    }
  }

  return { ok: missing.length === 0, missing };
}

/** Transitions that must carry a written reason. */
export function requiresReason(to: BookingStatus): boolean {
  return to === BookingStatus.CANCELLED || to === BookingStatus.NEEDS_REVIEW;
}

export class InvalidTransitionError extends Error {
  readonly from: BookingStatus;
  readonly to: BookingStatus;

  constructor(from: BookingStatus, to: BookingStatus) {
    const allowed = ALLOWED_TRANSITIONS[from];
    super(
      allowed.length === 0
        ? `A booking in ${from} is final and cannot move to ${to}.`
        : `A booking cannot move from ${from} to ${to}. Allowed: ${allowed.join(", ")}.`,
    );
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class MissingEvidenceError extends Error {
  readonly missing: readonly string[];

  constructor(to: BookingStatus, missing: readonly string[]) {
    super(
      `This booking cannot be marked ${to} yet. It still needs ${missing.join(", ")}.`,
    );
    this.name = "MissingEvidenceError";
    this.missing = missing;
  }
}

export class ReasonRequiredError extends Error {
  constructor(to: BookingStatus) {
    super(`Moving a booking to ${to} requires a reason.`);
    this.name = "ReasonRequiredError";
  }
}
