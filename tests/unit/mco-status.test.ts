import { describe, expect, it } from "vitest";

import { McoStatus } from "@/generated/prisma/enums";
import {
  allowedMcoTransitionsFrom,
  isMcoTerminal,
  isMcoTransitionAllowed,
  mcoReasonRequired,
  mcoSupplierIsSettled,
} from "@/lib/bookings/mco";

const ALL_STATUSES = Object.values(McoStatus);

describe("MCO transition matrix", () => {
  it("covers every status", () => {
    for (const status of ALL_STATUSES) {
      expect(allowedMcoTransitionsFrom(status)).toBeDefined();
    }
  });

  it("never allows a status to transition to itself", () => {
    for (const status of ALL_STATUSES) {
      expect(allowedMcoTransitionsFrom(status)).not.toContain(status);
    }
  });

  it("allows the normal settlement path", () => {
    expect(
      isMcoTransitionAllowed(McoStatus.NOT_APPLICABLE, McoStatus.PENDING),
    ).toBe(true);
    expect(isMcoTransitionAllowed(McoStatus.PENDING, McoStatus.SUBMITTED)).toBe(
      true,
    );
    expect(
      isMcoTransitionAllowed(McoStatus.SUBMITTED, McoStatus.CONFIRMED),
    ).toBe(true);
  });

  it("refuses to settle an MCO that was never submitted", () => {
    expect(isMcoTransitionAllowed(McoStatus.PENDING, McoStatus.CONFIRMED)).toBe(
      false,
    );
    expect(isMcoTransitionAllowed(McoStatus.PENDING, McoStatus.REJECTED)).toBe(
      false,
    );
    expect(
      isMcoTransitionAllowed(McoStatus.NOT_APPLICABLE, McoStatus.SUBMITTED),
    ).toBe(false);
    expect(
      isMcoTransitionAllowed(McoStatus.NOT_APPLICABLE, McoStatus.CONFIRMED),
    ).toBe(false);
  });

  it("treats a confirmed MCO as final", () => {
    expect(isMcoTerminal(McoStatus.CONFIRMED)).toBe(true);

    for (const status of ALL_STATUSES) {
      expect(isMcoTransitionAllowed(McoStatus.CONFIRMED, status)).toBe(false);
    }
  });

  it("lets a rejected MCO be corrected and raised again", () => {
    expect(isMcoTerminal(McoStatus.REJECTED)).toBe(false);
    expect(isMcoTransitionAllowed(McoStatus.REJECTED, McoStatus.PENDING)).toBe(
      true,
    );

    // But not straight back to the supplier without passing through PENDING,
    // which is where the correction is made.
    expect(
      isMcoTransitionAllowed(McoStatus.REJECTED, McoStatus.SUBMITTED),
    ).toBe(false);
  });

  it("lets an unsent MCO be withdrawn but a sent one not", () => {
    expect(
      isMcoTransitionAllowed(McoStatus.PENDING, McoStatus.NOT_APPLICABLE),
    ).toBe(true);
    expect(
      isMcoTransitionAllowed(McoStatus.SUBMITTED, McoStatus.NOT_APPLICABLE),
    ).toBe(false);
  });

  it("demands a reason for the moves someone must account for", () => {
    expect(mcoReasonRequired(McoStatus.REJECTED)).toBe(true);
    expect(mcoReasonRequired(McoStatus.NOT_APPLICABLE)).toBe(true);

    expect(mcoReasonRequired(McoStatus.PENDING)).toBe(false);
    expect(mcoReasonRequired(McoStatus.SUBMITTED)).toBe(false);
    expect(mcoReasonRequired(McoStatus.CONFIRMED)).toBe(false);
  });
});

describe("MCO supplier", () => {
  it("is fixed once the MCO has gone to the supplier", () => {
    expect(mcoSupplierIsSettled(McoStatus.SUBMITTED)).toBe(true);
    expect(mcoSupplierIsSettled(McoStatus.CONFIRMED)).toBe(true);
  });

  it("is editable while the MCO is still in hand", () => {
    expect(mcoSupplierIsSettled(McoStatus.NOT_APPLICABLE)).toBe(false);
    expect(mcoSupplierIsSettled(McoStatus.PENDING)).toBe(false);

    // A rejected MCO is corrected before going round again, and the wrong
    // supplier is one of the things that gets corrected.
    expect(mcoSupplierIsSettled(McoStatus.REJECTED)).toBe(false);
  });

  it("is editable from every status the MCO can be submitted from", () => {
    // Otherwise naming the supplier and submitting in one step — the whole
    // point of the combined form — would be impossible.
    for (const status of ALL_STATUSES) {
      if (!isMcoTransitionAllowed(status, McoStatus.SUBMITTED)) continue;
      expect(mcoSupplierIsSettled(status)).toBe(false);
    }
  });
});
