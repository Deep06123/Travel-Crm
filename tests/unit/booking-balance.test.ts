import { describe, expect, it } from "vitest";

import {
  RefundExceedsCollectedError,
  assertRefundable,
  computeBookingPosition,
  type BookingFinancialInput,
} from "@/lib/financial/booking-balance";
import { CurrencyMismatchError } from "@/lib/financial/money";

/**
 * The financial definitions.
 *
 * These exist because the plan requires each term to mean one specific thing
 * before any report is built on it. The cases below pin those meanings down —
 * particularly that contracted value and collected money are different numbers.
 */

function input(overrides: Partial<BookingFinancialInput> = {}): BookingFinancialInput {
  return {
    currency: "USD",
    grossBookingValueMinor: 102_997,
    supplierCostMinor: 92_697,
    grossMcoMinor: 102_997,
    netMcoMinor: 92_697,
    capturedPayments: [],
    authorizedPayments: [],
    completedRefunds: [],
    openChargebacks: [],
    adjustments: [],
    ...overrides,
  };
}

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

describe("gross booking value vs collected", () => {
  it("does not treat a booking with no payments as collected", () => {
    const position = computeBookingPosition(input());

    // The customer is contracted for the full amount…
    expect(position.grossBookingValueMinor).toBe(102_997);
    // …but nothing has been collected, and the two must not be conflated.
    expect(position.amountCollectedMinor).toBe(0);
    expect(position.outstandingBalanceMinor).toBe(102_997);
    expect(position.isFullyPaid).toBe(false);
  });

  it("does not count an authorisation as collected", () => {
    const position = computeBookingPosition(
      input({ authorizedPayments: [usd(102_997)] }),
    );

    // Money reserved is not money taken.
    expect(position.amountAuthorizedMinor).toBe(102_997);
    expect(position.amountCollectedMinor).toBe(0);
    expect(position.outstandingBalanceMinor).toBe(102_997);
  });

  it("counts a captured payment as collected", () => {
    const position = computeBookingPosition(
      input({ capturedPayments: [usd(102_997)] }),
    );

    expect(position.amountCollectedMinor).toBe(102_997);
    expect(position.outstandingBalanceMinor).toBe(0);
    expect(position.isFullyPaid).toBe(true);
  });

  it("handles part payment across several captures", () => {
    const position = computeBookingPosition(
      input({ capturedPayments: [usd(50_000), usd(25_000)] }),
    );

    expect(position.amountCollectedMinor).toBe(75_000);
    expect(position.outstandingBalanceMinor).toBe(27_997);
    expect(position.isFullyPaid).toBe(false);
  });

  it("flags an overpayment rather than hiding it", () => {
    const position = computeBookingPosition(
      input({ capturedPayments: [usd(150_000)] }),
    );

    expect(position.outstandingBalanceMinor).toBe(-47_003);
    expect(position.isOverpaid).toBe(true);
  });
});

describe("refunds", () => {
  it("reduces net collected only once completed", () => {
    const position = computeBookingPosition(
      input({
        capturedPayments: [usd(102_997)],
        completedRefunds: [usd(50_000)],
      }),
    );

    expect(position.amountRefundedMinor).toBe(50_000);
    expect(position.netCollectedMinor).toBe(52_997);
    expect(position.outstandingBalanceMinor).toBe(50_000);
  });

  it("makes only collected-and-not-yet-refunded money refundable", () => {
    const position = computeBookingPosition(
      input({
        capturedPayments: [usd(100_000)],
        completedRefunds: [usd(30_000)],
      }),
    );

    expect(position.refundableAmountMinor).toBe(70_000);
  });

  it("never reports a negative refundable amount", () => {
    const position = computeBookingPosition(
      input({
        capturedPayments: [usd(10_000)],
        completedRefunds: [usd(25_000)],
      }),
    );

    expect(position.netCollectedMinor).toBe(-15_000);
    expect(position.refundableAmountMinor).toBe(0);
  });
});

describe("margin and MCO", () => {
  it("computes margin from booking value and supplier cost", () => {
    expect(computeBookingPosition(input()).marginMinor).toBe(10_300);
  });

  it("reports a negative margin rather than clamping it", () => {
    const position = computeBookingPosition(
      input({ grossBookingValueMinor: 50_000, supplierCostMinor: 60_000 }),
    );

    expect(position.marginMinor).toBe(-10_000);
  });

  it("keeps MCO separate from booking value", () => {
    const position = computeBookingPosition(
      input({ grossBookingValueMinor: 100_000, grossMcoMinor: 75_000, netMcoMinor: 60_000 }),
    );

    // MCO is its own measure and must not be derived from booking value.
    expect(position.grossBookingValueMinor).toBe(100_000);
    expect(position.grossMcoMinor).toBe(75_000);
    expect(position.netMcoMinor).toBe(60_000);
  });
});

describe("chargebacks and adjustments", () => {
  it("reports disputed amounts without deducting them from collected", () => {
    const position = computeBookingPosition(
      input({
        capturedPayments: [usd(102_997)],
        openChargebacks: [usd(102_997)],
      }),
    );

    // The money is still with us while the dispute is open; the exposure is
    // reported separately rather than pre-emptively written off.
    expect(position.amountDisputedMinor).toBe(102_997);
    expect(position.amountCollectedMinor).toBe(102_997);
  });

  it("applies a signed adjustment to the outstanding balance", () => {
    const position = computeBookingPosition(
      input({
        capturedPayments: [usd(100_000)],
        adjustments: [usd(2_997)],
      }),
    );

    // A 2,997 write-off closes the remaining balance.
    expect(position.outstandingBalanceMinor).toBe(0);
  });

  it("accepts a negative adjustment", () => {
    const position = computeBookingPosition(
      input({ capturedPayments: [usd(102_997)], adjustments: [usd(-5_000)] }),
    );

    expect(position.adjustmentsMinor).toBe(-5_000);
    expect(position.outstandingBalanceMinor).toBe(5_000);
  });
});

describe("currency safety", () => {
  it("refuses a payment in a different currency from the booking", () => {
    expect(() =>
      computeBookingPosition(
        input({ capturedPayments: [{ amountMinor: 10_000, currency: "EUR" }] }),
      ),
    ).toThrow(CurrencyMismatchError);
  });

  it("refuses a refund in a different currency", () => {
    expect(() =>
      computeBookingPosition(
        input({
          capturedPayments: [usd(10_000)],
          completedRefunds: [{ amountMinor: 5_000, currency: "GBP" }],
        }),
      ),
    ).toThrow(CurrencyMismatchError);
  });

  it("compares currency case-insensitively", () => {
    expect(() =>
      computeBookingPosition(
        input({ capturedPayments: [{ amountMinor: 10_000, currency: "usd" }] }),
      ),
    ).not.toThrow();
  });
});

describe("assertRefundable", () => {
  const collected = computeBookingPosition(
    input({ capturedPayments: [usd(100_000)] }),
  );

  it("permits a refund within what was collected", () => {
    expect(() => assertRefundable(50_000, collected)).not.toThrow();
    expect(() => assertRefundable(100_000, collected)).not.toThrow();
  });

  it("refuses a refund larger than what was collected", () => {
    expect(() => assertRefundable(100_001, collected)).toThrow(
      RefundExceedsCollectedError,
    );
  });

  it("counts refunds already in flight against the available balance", () => {
    // 40,000 is already requested, so only 60,000 remains available.
    expect(() => assertRefundable(60_000, collected, 40_000)).not.toThrow();
    expect(() => assertRefundable(60_001, collected, 40_000)).toThrow(
      RefundExceedsCollectedError,
    );
  });

  it("refuses any refund when nothing was collected", () => {
    const nothing = computeBookingPosition(input());
    expect(() => assertRefundable(1, nothing)).toThrow(RefundExceedsCollectedError);
  });

  it("names both amounts in the message, so the operator can act on it", () => {
    try {
      assertRefundable(150_000, collected);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RefundExceedsCollectedError);
      expect((error as Error).message).toContain("1500.00");
      expect((error as Error).message).toContain("1000.00");
    }
  });
});
