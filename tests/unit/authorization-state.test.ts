import { describe, expect, it } from "vitest";

import {
  authorizationSummary,
  hasSignedAuthorization,
  type LatestSignature,
} from "@/lib/bookings/authorization-state";
import { BookingSignatureStatus } from "@/generated/prisma/enums";

const NOW = new Date("2026-11-12T12:00:00Z");

/** A request sent today, open for another fortnight. */
function sent(overrides: Partial<LatestSignature> = {}): LatestSignature {
  return {
    status: BookingSignatureStatus.SENT,
    sentAt: new Date("2026-11-12T09:00:00Z"),
    viewedAt: null,
    signedAt: null,
    expiresAt: new Date("2026-11-26T09:00:00Z"),
    ...overrides,
  };
}

describe("authorizationSummary", () => {
  it("reports a booking with no request as not sent", () => {
    const summary = authorizationSummary(null, null, NOW);

    expect(summary.state).toBe("NOT_SENT");
    expect(summary.at).toBeNull();
  });

  it("reports an unopened live request as sent, dated when it went out", () => {
    const latest = sent();
    const summary = authorizationSummary(latest, null, NOW);

    expect(summary.state).toBe("SENT");
    expect(summary.at).toEqual(latest.sentAt);
  });

  it("distinguishes a request the customer opened from one they did not", () => {
    const viewedAt = new Date("2026-11-12T10:30:00Z");
    const summary = authorizationSummary(
      sent({ status: BookingSignatureStatus.VIEWED, viewedAt }),
      null,
      NOW,
    );

    expect(summary.state).toBe("VIEWED");
    expect(summary.at).toEqual(viewedAt);
  });

  it("reports a signed request as signed", () => {
    const signedAt = new Date("2026-11-12T11:00:00Z");
    const summary = authorizationSummary(
      sent({ status: BookingSignatureStatus.SIGNED, signedAt }),
      signedAt,
      NOW,
    );

    expect(summary.state).toBe("SIGNED");
    expect(summary.at).toEqual(signedAt);
  });

  /**
   * The case the whole `authorizedAt` parameter exists for.
   *
   * Resending writes a fresh unsigned row and deliberately leaves the signed
   * one alone, so the newest row on an authorized booking reads SENT. Reading
   * the state off that row alone would strip the authorization off a booking
   * every time somebody resent the email.
   */
  it("stays signed when a later unsigned request was sent on top", () => {
    const signedAt = new Date("2026-11-01T09:00:00Z");
    const summary = authorizationSummary(sent(), signedAt, NOW);

    expect(summary.state).toBe("SIGNED");
    expect(summary.at).toEqual(signedAt);
  });

  it("treats a link past its expiry as expired even while marked sent", () => {
    const expiresAt = new Date("2026-11-10T09:00:00Z");
    const summary = authorizationSummary(
      sent({ sentAt: new Date("2026-10-27T09:00:00Z"), expiresAt }),
      null,
      NOW,
    );

    expect(summary.state).toBe("EXPIRED");
    expect(summary.at).toEqual(expiresAt);
  });

  it("expires on the stroke of the expiry rather than a moment after", () => {
    const expiresAt = new Date(NOW);
    const summary = authorizationSummary(sent({ expiresAt }), null, NOW);

    expect(summary.state).toBe("EXPIRED");
  });

  it("treats an explicitly expired row as expired whatever its dates say", () => {
    const summary = authorizationSummary(
      sent({ status: BookingSignatureStatus.EXPIRED }),
      null,
      NOW,
    );

    expect(summary.state).toBe("EXPIRED");
  });

  it("treats a revoked row as expired — nothing is outstanding either way", () => {
    const summary = authorizationSummary(
      sent({ status: BookingSignatureStatus.REVOKED }),
      null,
      NOW,
    );

    expect(summary.state).toBe("EXPIRED");
  });

  it("reads a signed row on its own, without the looked-up date", () => {
    const signedAt = new Date("2026-11-12T11:00:00Z");
    const summary = authorizationSummary(
      sent({ status: BookingSignatureStatus.SIGNED, signedAt }),
      null,
      NOW,
    );

    expect(summary.state).toBe("SIGNED");
    expect(summary.at).toEqual(signedAt);
  });

  it("prefers a signature to an expiry — a signed link expiring is still signed", () => {
    const signedAt = new Date("2026-10-28T09:00:00Z");
    const summary = authorizationSummary(
      sent({
        status: BookingSignatureStatus.SIGNED,
        signedAt,
        expiresAt: new Date("2026-11-01T09:00:00Z"),
      }),
      signedAt,
      NOW,
    );

    expect(summary.state).toBe("SIGNED");
  });

  it("gives every state but NOT_SENT a date to show", () => {
    const cases = [
      authorizationSummary(sent(), null, NOW),
      authorizationSummary(
        sent({ status: BookingSignatureStatus.VIEWED, viewedAt: NOW }),
        null,
        NOW,
      ),
      authorizationSummary(sent(), new Date("2026-11-01T09:00:00Z"), NOW),
      authorizationSummary(
        sent({ expiresAt: new Date("2026-11-01T09:00:00Z") }),
        null,
        NOW,
      ),
    ];

    for (const summary of cases) {
      expect(summary.state).not.toBe("NOT_SENT");
      expect(summary.at).not.toBeNull();
    }
  });
});

describe("hasSignedAuthorization", () => {
  it("is true only for a signed booking", () => {
    expect(
      hasSignedAuthorization(authorizationSummary(sent(), NOW, NOW)),
    ).toBe(true);

    for (const summary of [
      authorizationSummary(null, null, NOW),
      authorizationSummary(sent(), null, NOW),
      authorizationSummary(
        sent({ expiresAt: new Date("2026-11-01T09:00:00Z") }),
        null,
        NOW,
      ),
    ]) {
      expect(hasSignedAuthorization(summary)).toBe(false);
    }
  });
});
