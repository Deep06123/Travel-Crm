import { CurrencyMismatchError, type Money } from "./money";

/**
 * Booking financial position.
 *
 * The plan requires every financial term to have a documented meaning before
 * reports are built on it. These are those definitions, in one place, as pure
 * functions over integer minor units.
 *
 * ---------------------------------------------------------------------------
 * Term                 Definition
 * ---------------------------------------------------------------------------
 * baseFare             The fare before taxes and fees.
 * taxesFees            Taxes, carrier charges and service fees.
 * grossBookingValue    What the customer is contracted to pay. Stored as
 *                      `Booking.totalMinor`. Independent of whether any money
 *                      has actually moved.
 * supplierCost         What we owe the supplier for fulfilling the booking.
 * margin               grossBookingValue − supplierCost. May be negative.
 * grossMco             The MCO value before deductions, as the reference CRM
 *                      reports it. Tracked separately from booking value;
 *                      the two are NOT interchangeable.
 * netMco               The MCO value after deductions.
 * amountCollected      Sum of payments in CAPTURED state only. A pending
 *                      payment, an authorisation, or a saved payment link
 *                      contributes nothing.
 * amountAuthorized     Sum of payments merely AUTHORIZED — money reserved but
 *                      not taken. Reported apart from collected.
 * amountRefunded       Sum of refunds in COMPLETED state only, using the
 *                      approved amount. An approved-but-unprocessed refund has
 *                      not left the account.
 * amountDisputed       Sum of chargebacks not yet resolved in our favour.
 * netCollected         amountCollected − amountRefunded.
 * outstandingBalance   grossBookingValue − netCollected. Positive means the
 *                      customer still owes; negative means they are owed.
 * refundableAmount     netCollected, floored at zero — never refund more than
 *                      has actually been collected and not already returned.
 * ---------------------------------------------------------------------------
 *
 * Every figure carries its currency. Mixing currencies throws rather than
 * producing a number that means nothing.
 */

export interface BookingFinancialInput {
  currency: string;

  grossBookingValueMinor: number;
  supplierCostMinor: number;
  grossMcoMinor: number;
  netMcoMinor: number;

  /** Captured payments only. */
  capturedPayments: readonly Money[];
  /** Authorised but not captured. */
  authorizedPayments: readonly Money[];
  /** Completed refunds only, at their approved amount. */
  completedRefunds: readonly Money[];
  /** Chargebacks not yet resolved in our favour. */
  openChargebacks: readonly Money[];
  /** Signed adjustments: positive increases what we collect. */
  adjustments: readonly Money[];
}

export interface BookingFinancialPosition {
  currency: string;

  grossBookingValueMinor: number;
  supplierCostMinor: number;
  marginMinor: number;
  grossMcoMinor: number;
  netMcoMinor: number;

  amountCollectedMinor: number;
  amountAuthorizedMinor: number;
  amountRefundedMinor: number;
  amountDisputedMinor: number;
  adjustmentsMinor: number;

  netCollectedMinor: number;
  outstandingBalanceMinor: number;
  refundableAmountMinor: number;

  /** True when the customer has paid the full contracted amount. */
  isFullyPaid: boolean;
  /** True when more has been collected than contracted — usually an error. */
  isOverpaid: boolean;
}

/**
 * Sums amounts that must all share `currency`.
 *
 * Throws on a stray currency rather than silently dropping or adding it; a
 * booking whose payments disagree with its own currency is a data problem that
 * must surface, not be averaged away.
 */
function sumIn(currency: string, amounts: readonly Money[]): number {
  let total = 0;

  for (const amount of amounts) {
    if (amount.currency.toUpperCase() !== currency.toUpperCase()) {
      throw new CurrencyMismatchError([currency, amount.currency]);
    }
    total += amount.amountMinor;
  }

  return total;
}

export function computeBookingPosition(
  input: BookingFinancialInput,
): BookingFinancialPosition {
  const currency = input.currency.toUpperCase();

  const amountCollectedMinor = sumIn(currency, input.capturedPayments);
  const amountAuthorizedMinor = sumIn(currency, input.authorizedPayments);
  const amountRefundedMinor = sumIn(currency, input.completedRefunds);
  const amountDisputedMinor = sumIn(currency, input.openChargebacks);
  const adjustmentsMinor = sumIn(currency, input.adjustments);

  const netCollectedMinor = amountCollectedMinor - amountRefundedMinor;

  const outstandingBalanceMinor =
    input.grossBookingValueMinor - netCollectedMinor - adjustmentsMinor;

  return {
    currency,

    grossBookingValueMinor: input.grossBookingValueMinor,
    supplierCostMinor: input.supplierCostMinor,
    marginMinor: input.grossBookingValueMinor - input.supplierCostMinor,
    grossMcoMinor: input.grossMcoMinor,
    netMcoMinor: input.netMcoMinor,

    amountCollectedMinor,
    amountAuthorizedMinor,
    amountRefundedMinor,
    amountDisputedMinor,
    adjustmentsMinor,

    netCollectedMinor,
    outstandingBalanceMinor,
    // Never offer to refund money that was not collected, or that has already
    // been returned.
    refundableAmountMinor: Math.max(0, netCollectedMinor),

    isFullyPaid: outstandingBalanceMinor <= 0,
    isOverpaid: outstandingBalanceMinor < 0,
  };
}

export class RefundExceedsCollectedError extends Error {
  readonly requestedMinor: number;
  readonly refundableMinor: number;

  constructor(requestedMinor: number, refundableMinor: number, currency: string) {
    const format = (minor: number) => (minor / 100).toFixed(2);
    super(
      `Cannot refund ${format(requestedMinor)} ${currency}: only ${format(refundableMinor)} ${currency} has been collected and not already refunded.`,
    );
    this.name = "RefundExceedsCollectedError";
    this.requestedMinor = requestedMinor;
    this.refundableMinor = refundableMinor;
  }
}

/**
 * Checks a refund request against what is actually refundable.
 *
 * `pendingRefundsMinor` covers requests already raised but not yet completed,
 * so two concurrent requests for the full balance cannot both be approved.
 */
export function assertRefundable(
  requestedMinor: number,
  position: BookingFinancialPosition,
  pendingRefundsMinor = 0,
): void {
  const available = position.refundableAmountMinor - pendingRefundsMinor;

  if (requestedMinor > available) {
    throw new RefundExceedsCollectedError(
      requestedMinor,
      Math.max(0, available),
      position.currency,
    );
  }
}
