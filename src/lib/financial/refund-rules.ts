import { RefundStatus } from "@/generated/prisma/enums";

/**
 * Refund lifecycle rules.
 *
 * Pure logic so the state machine can be tested exhaustively, mirroring the
 * approach taken for booking status. The service applies these inside a
 * transaction.
 */

const ALLOWED_TRANSITIONS: Readonly<Record<RefundStatus, readonly RefundStatus[]>> = {
  // A request awaits a decision.
  [RefundStatus.PENDING]: [RefundStatus.APPROVED, RefundStatus.REJECTED],

  // Approved money is then executed, or abandoned if the decision is reversed
  // before any money moves.
  [RefundStatus.APPROVED]: [RefundStatus.PROCESSING, RefundStatus.REJECTED],

  // Once processing has begun it either settles or fails.
  [RefundStatus.PROCESSING]: [RefundStatus.COMPLETED, RefundStatus.FAILED],

  // A failed attempt may be retried.
  [RefundStatus.FAILED]: [RefundStatus.PROCESSING, RefundStatus.REJECTED],

  // Terminal. Money has left the account; reversing it means a new charge.
  [RefundStatus.COMPLETED]: [],

  // Terminal. A rejected request is closed; raise a new one instead.
  [RefundStatus.REJECTED]: [],
};

export function allowedRefundTransitionsFrom(
  status: RefundStatus,
): readonly RefundStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function isRefundTransitionAllowed(
  from: RefundStatus,
  to: RefundStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isRefundTerminal(status: RefundStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/** Statuses in which a refund still counts against the refundable balance. */
export const IN_FLIGHT_REFUND_STATUSES: readonly RefundStatus[] = [
  RefundStatus.PENDING,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
];

/**
 * True when the refund is still claiming money that has not yet left.
 *
 * Used to stop two concurrent requests each being approved for the full
 * balance.
 */
export function isInFlight(status: RefundStatus): boolean {
  return IN_FLIGHT_REFUND_STATUSES.includes(status);
}

export class InvalidRefundTransitionError extends Error {
  constructor(from: RefundStatus, to: RefundStatus) {
    const allowed = ALLOWED_TRANSITIONS[from];
    super(
      allowed.length === 0
        ? `A ${from} refund is final and cannot move to ${to}.`
        : `A refund cannot move from ${from} to ${to}. Allowed: ${allowed.join(", ")}.`,
    );
    this.name = "InvalidRefundTransitionError";
  }
}

/**
 * Decides whether a refund needs elevated approval.
 *
 * Above the configured threshold an ordinary finance approval is not enough —
 * the plan calls for a documented approval rule, and the threshold lives in
 * business settings so it can be changed without a deploy.
 */
export function requiresElevatedApproval(
  amountMinor: number,
  thresholdMinor: number,
): boolean {
  return amountMinor >= thresholdMinor;
}

export class ApprovalThresholdError extends Error {
  constructor(amountMinor: number, thresholdMinor: number, currency: string) {
    const format = (minor: number) => (minor / 100).toFixed(2);
    super(
      `A refund of ${format(amountMinor)} ${currency} is at or above the ${format(thresholdMinor)} ${currency} threshold and needs a super administrator's approval.`,
    );
    this.name = "ApprovalThresholdError";
  }
}

export class SelfApprovalError extends Error {
  constructor() {
    super(
      "A refund cannot be approved by the person who requested it. Ask another authorised approver.",
    );
    this.name = "SelfApprovalError";
  }
}
