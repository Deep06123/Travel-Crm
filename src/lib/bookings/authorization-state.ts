import { BookingSignatureStatus } from "@/generated/prisma/enums";

/**
 * Where a booking's authorization email has got to.
 *
 * Pure logic with no database access, as `status.ts` and `mco.ts` are, so the
 * derivation can be unit-tested over every combination rather than inspected
 * through a rendered table.
 *
 * The column this feeds answers two questions at once — did the email go out,
 * and did the customer authorize — and they are not the same question. An
 * email that was sent and ignored and an email that was never sent look
 * identical if only the second is reported, and they call for opposite
 * actions: chase the customer, or send the thing.
 */

export type AuthorizationState =
  /** No authorization email has ever been sent for this booking. */
  | "NOT_SENT"
  /** Sent, and the customer has not opened the link yet. */
  | "SENT"
  /** The customer opened the signing page but did not authorize. */
  | "VIEWED"
  /** The customer authorized. The booking has consent on file. */
  | "SIGNED"
  /** Sent, never signed, and the link has passed its expiry. */
  | "EXPIRED";

/** The newest authorization request, as the list reads it. */
export interface LatestSignature {
  status: BookingSignatureStatus;
  sentAt: Date;
  viewedAt: Date | null;
  signedAt: Date | null;
  expiresAt: Date;
}

export interface AuthorizationSummary {
  state: AuthorizationState;
  /**
   * The moment the state refers to — sent, opened, signed or expired.
   *
   * Null only for `NOT_SENT`, which refers to no moment at all.
   */
  at: Date | null;
}

/**
 * Reads the authorization state from the newest request and the signed date.
 *
 * `authorizedAt` wins over everything the newest row says. Sending a fresh
 * invitation writes a new unsigned row and deliberately leaves any signed one
 * untouched, so on an authorized booking the newest row routinely reads SENT.
 * Deriving "is this authorized" from that row would strip the authorization
 * off a booking every time somebody resent the email — turning a resend into
 * an apparent loss of consent the booking still has.
 *
 * `now` is a parameter rather than a call to the clock so expiry is testable
 * and so a server-rendered row and its assertions agree on when "now" was.
 */
export function authorizationSummary(
  latest: LatestSignature | null,
  authorizedAt: Date | null,
  now: Date = new Date(),
): AuthorizationSummary {
  if (authorizedAt) return { state: "SIGNED", at: authorizedAt };

  if (!latest) return { state: "NOT_SENT", at: null };

  // A row of its own can be signed without `authorizedAt` having been looked
  // up — a caller that only has the one row still gets the right answer.
  if (latest.signedAt) return { state: "SIGNED", at: latest.signedAt };

  // Revoked means a later invitation replaced this one, so the only way a
  // revoked row is also the newest is that the replacement was never written.
  // Either way nothing is outstanding and the link is dead, which is what
  // expired says.
  if (
    latest.status === BookingSignatureStatus.EXPIRED ||
    latest.status === BookingSignatureStatus.REVOKED ||
    latest.expiresAt.getTime() <= now.getTime()
  ) {
    return { state: "EXPIRED", at: latest.expiresAt };
  }

  if (latest.viewedAt) return { state: "VIEWED", at: latest.viewedAt };

  return { state: "SENT", at: latest.sentAt };
}

/** Whether there is a signed authorization to download for this booking. */
export function hasSignedAuthorization(
  summary: AuthorizationSummary,
): boolean {
  return summary.state === "SIGNED";
}
