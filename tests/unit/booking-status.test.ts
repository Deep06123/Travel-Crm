import { describe, expect, it } from "vitest";

import { BookingStatus, TicketStatus } from "@/generated/prisma/enums";
import {
  allowedTransitionsFrom,
  checkEvidenceFor,
  isTerminal,
  isTransitionAllowed,
  requiresReason,
  type BookingEvidence,
} from "@/lib/bookings/status";

const ALL_STATUSES = Object.values(BookingStatus);

describe("transition matrix", () => {
  it("covers every status", () => {
    for (const status of ALL_STATUSES) {
      expect(allowedTransitionsFrom(status)).toBeDefined();
    }
  });

  it("never allows a status to transition to itself", () => {
    for (const status of ALL_STATUSES) {
      expect(allowedTransitionsFrom(status)).not.toContain(status);
    }
  });

  it("allows the normal forward path", () => {
    expect(isTransitionAllowed(BookingStatus.DRAFT, BookingStatus.PENDING)).toBe(true);
    expect(isTransitionAllowed(BookingStatus.PENDING, BookingStatus.CONFIRMED)).toBe(true);
    expect(isTransitionAllowed(BookingStatus.CONFIRMED, BookingStatus.TICKETED)).toBe(true);
    expect(isTransitionAllowed(BookingStatus.TICKETED, BookingStatus.COMPLETED)).toBe(true);
  });

  it("refuses to skip confirmation", () => {
    expect(isTransitionAllowed(BookingStatus.PENDING, BookingStatus.TICKETED)).toBe(false);
    expect(isTransitionAllowed(BookingStatus.DRAFT, BookingStatus.CONFIRMED)).toBe(false);
    expect(isTransitionAllowed(BookingStatus.DRAFT, BookingStatus.TICKETED)).toBe(false);
  });

  it("refuses to move backwards along the money path", () => {
    expect(isTransitionAllowed(BookingStatus.TICKETED, BookingStatus.CONFIRMED)).toBe(false);
    expect(isTransitionAllowed(BookingStatus.CONFIRMED, BookingStatus.PENDING)).toBe(false);
    expect(isTransitionAllowed(BookingStatus.COMPLETED, BookingStatus.TICKETED)).toBe(false);
  });

  it("treats cancellation as final", () => {
    expect(isTerminal(BookingStatus.CANCELLED)).toBe(true);

    for (const status of ALL_STATUSES) {
      expect(isTransitionAllowed(BookingStatus.CANCELLED, status)).toBe(false);
    }
  });

  it("allows cancellation from every non-terminal status", () => {
    for (const status of ALL_STATUSES) {
      if (status === BookingStatus.CANCELLED || status === BookingStatus.COMPLETED) {
        continue;
      }
      expect(isTransitionAllowed(status, BookingStatus.CANCELLED)).toBe(true);
    }
  });

  it("lets a completed booking reopen for review but nothing else", () => {
    expect(allowedTransitionsFrom(BookingStatus.COMPLETED)).toEqual([
      BookingStatus.NEEDS_REVIEW,
    ]);
  });

  it("lets review send a booking back to pending", () => {
    expect(
      isTransitionAllowed(BookingStatus.NEEDS_REVIEW, BookingStatus.PENDING),
    ).toBe(true);
  });
});

describe("requiresReason", () => {
  it("demands a reason for cancellation and review", () => {
    expect(requiresReason(BookingStatus.CANCELLED)).toBe(true);
    expect(requiresReason(BookingStatus.NEEDS_REVIEW)).toBe(true);
  });

  it("does not demand one for the normal forward path", () => {
    expect(requiresReason(BookingStatus.CONFIRMED)).toBe(false);
    expect(requiresReason(BookingStatus.TICKETED)).toBe(false);
    expect(requiresReason(BookingStatus.COMPLETED)).toBe(false);
  });
});

function evidence(overrides: Partial<BookingEvidence> = {}): BookingEvidence {
  return {
    airlineConfirmation: "ABC123",
    ticketStatus: TicketStatus.ISSUED,
    ticketedAt: new Date(),
    passengerCount: 1,
    hasIssuedTicketNumbers: true,
    ...overrides,
  };
}

describe("checkEvidenceFor", () => {
  it("accepts a confirmation that has a reference and a passenger", () => {
    expect(checkEvidenceFor(BookingStatus.CONFIRMED, evidence()).ok).toBe(true);
  });

  it("refuses confirmation without a supplier reference", () => {
    const result = checkEvidenceFor(
      BookingStatus.CONFIRMED,
      evidence({ airlineConfirmation: null }),
    );

    expect(result.ok).toBe(false);
    expect(result.missing.join(" ")).toContain("confirmation reference");
  });

  it("treats a whitespace-only reference as absent", () => {
    expect(
      checkEvidenceFor(
        BookingStatus.CONFIRMED,
        evidence({ airlineConfirmation: "   " }),
      ).ok,
    ).toBe(false);
  });

  it("refuses confirmation with no passengers", () => {
    expect(
      checkEvidenceFor(BookingStatus.CONFIRMED, evidence({ passengerCount: 0 })).ok,
    ).toBe(false);
  });

  it("refuses ticketing until a ticket was actually issued", () => {
    const result = checkEvidenceFor(
      BookingStatus.TICKETED,
      evidence({ ticketStatus: TicketStatus.PENDING }),
    );

    expect(result.ok).toBe(false);
    expect(result.missing.join(" ")).toContain("Issued");
  });

  it("refuses ticketing without a ticket number", () => {
    const result = checkEvidenceFor(
      BookingStatus.TICKETED,
      evidence({ hasIssuedTicketNumbers: false }),
    );

    expect(result.ok).toBe(false);
    expect(result.missing.join(" ")).toContain("ticket number");
  });

  it("reports every missing item at once rather than one at a time", () => {
    const result = checkEvidenceFor(
      BookingStatus.TICKETED,
      evidence({
        ticketStatus: TicketStatus.PENDING,
        hasIssuedTicketNumbers: false,
        airlineConfirmation: null,
      }),
    );

    expect(result.missing).toHaveLength(3);
  });

  it("imposes no evidence requirement on cancellation", () => {
    expect(
      checkEvidenceFor(
        BookingStatus.CANCELLED,
        evidence({
          airlineConfirmation: null,
          passengerCount: 0,
          ticketStatus: TicketStatus.PENDING,
          hasIssuedTicketNumbers: false,
        }),
      ).ok,
    ).toBe(true);
  });
});
