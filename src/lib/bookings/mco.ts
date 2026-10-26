import { McoStatus } from "@/generated/prisma/enums";

/**
 * MCO settlement rules.
 *
 * Pure logic, deliberately free of database access so the transition matrix can
 * be unit-tested exhaustively — the same split the booking lifecycle uses in
 * `src/lib/bookings/status.ts`. The service in
 * `src/server/services/mco-service.ts` applies these rules inside a transaction
 * and writes the audit entry.
 *
 * An MCO answers one question only: where is this booking's miscellaneous
 * charge order in its settlement cycle with the MCO supplier. It is independent
 * of booking status and of ticketing — a confirmed booking may have a rejected
 * MCO, and a pending MCO does not hold up ticketing.
 */

/** MCO statuses a booking sitting in `from` may move to. */
const ALLOWED_TRANSITIONS: Readonly<Record<McoStatus, readonly McoStatus[]>> = {
  // No MCO was raised at booking time. Raising one later is ordinary: a change
  // fee or an add-on collected after the fact is exactly what an MCO is for.
  [McoStatus.NOT_APPLICABLE]: [McoStatus.PENDING],

  // Raised but not yet sent to the supplier. It can still be withdrawn, which
  // returns the booking to having no MCO at all rather than inventing a
  // "cancelled" state the reports would have to learn about.
  [McoStatus.PENDING]: [McoStatus.SUBMITTED, McoStatus.NOT_APPLICABLE],

  // With the supplier. They either settle it or send it back.
  [McoStatus.SUBMITTED]: [McoStatus.CONFIRMED, McoStatus.REJECTED],

  // Terminal. The supplier has settled; unwinding that is a new MCO, not an
  // edit to this one, so the settled record keeps its own history intact.
  [McoStatus.CONFIRMED]: [],

  // Not terminal: a rejection is usually a correctable fault — wrong amount,
  // wrong supplier reference — and the corrected MCO goes round again.
  [McoStatus.REJECTED]: [McoStatus.PENDING],
};

/**
 * Statuses whose move must carry a written reason.
 *
 * Both are moves that someone will later have to account for: why the supplier
 * refused, and why a raised MCO was dropped.
 */
const REASON_REQUIRED: readonly McoStatus[] = [
  McoStatus.REJECTED,
  McoStatus.NOT_APPLICABLE,
];

export function allowedMcoTransitionsFrom(
  status: McoStatus,
): readonly McoStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function isMcoTransitionAllowed(
  from: McoStatus,
  to: McoStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** True when no further movement is possible from `status`. */
export function isMcoTerminal(status: McoStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export function mcoReasonRequired(status: McoStatus): boolean {
  return REASON_REQUIRED.includes(status);
}

/**
 * Statuses from which the MCO supplier is fixed.
 *
 * Once an MCO has gone to a supplier, who it went to is part of the record
 * rather than a field. Re-pointing it would leave the audit trail saying a
 * claim was made against a supplier who never saw it.
 */
const SUPPLIER_SETTLED: readonly McoStatus[] = [
  McoStatus.SUBMITTED,
  McoStatus.CONFIRMED,
];

export function mcoSupplierIsSettled(status: McoStatus): boolean {
  return SUPPLIER_SETTLED.includes(status);
}

/** Raised when the requested move is not on the matrix. */
export class InvalidMcoTransitionError extends Error {
  constructor(
    readonly from: McoStatus,
    readonly to: McoStatus,
  ) {
    super(`An MCO cannot move from ${from} to ${to}.`);
    this.name = "InvalidMcoTransitionError";
  }
}

/** Raised when a move that must be explained arrives without an explanation. */
export class McoReasonRequiredError extends Error {
  constructor(readonly to: McoStatus) {
    super(`Moving an MCO to ${to} requires a reason.`);
    this.name = "McoReasonRequiredError";
  }
}

/** Raised when the booking is in no condition to carry the requested MCO state. */
export class McoNotUpdatableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "McoNotUpdatableError";
  }
}
