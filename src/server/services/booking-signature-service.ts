import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { AuditAction, BookingSignatureStatus } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { lookupIp } from "@/lib/geo/ip-lookup";
import { loggerFor } from "@/lib/logging/logger";

/**
 * Customer authorization links, and the e-signature evidence they return.
 *
 * The flow has three moments and this module owns all of them, so the rules
 * live in one place rather than being re-stated by the action that sends the
 * email and the route that accepts the signature:
 *
 *   1. An agent sends a link. A fresh row is written, any earlier unsigned row
 *      for that booking is revoked, and the raw token leaves here exactly once.
 *   2. The customer opens it. The row is resolved by token and marked VIEWED.
 *   3. The customer signs. Evidence is captured and the row becomes SIGNED.
 *
 * Token handling mirrors `src/lib/auth/session.ts`: 256 bits of CSPRNG output,
 * stored only as its SHA-256. The raw token exists in the emailed link and
 * nowhere else, so a dump of this table yields digests rather than usable
 * signing URLs. SHA-256 rather than bcrypt for the same reason as there — the
 * token is not guessable, so there is nothing for key stretching to protect.
 */

const log = loggerFor("booking-signature");

const TOKEN_BYTES = 32;

/**
 * How long a link stays usable.
 *
 * Long enough that a customer who reads their email at the weekend is not
 * locked out, short enough that a forwarded message does not stay live
 * indefinitely. A fresh send supersedes the old link regardless.
 */
const EXPIRY_DAYS = 14;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Statuses from which a row can still be opened and signed. */
const OPENABLE: BookingSignatureStatus[] = [
  BookingSignatureStatus.SENT,
  BookingSignatureStatus.VIEWED,
];

export interface IssuedSignatureRequest {
  id: string;
  /** Raw token for the link. Not recoverable after this returns. */
  token: string;
  expiresAt: Date;
}

/**
 * Mints an authorization link for a booking.
 *
 * Revoking the previous unsigned rows is what makes "resend" mean resend
 * rather than "issue a second valid link": two live tokens for one booking
 * would let the same authorization be signed twice from different devices,
 * and the evidence could not say which one the customer actually read.
 *
 * A row that has already been signed is left alone. It is the evidence.
 */
export async function createSignatureRequest(
  bookingId: string,
  recipientEmail: string,
  actorId: string,
): Promise<IssuedSignatureRequest> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1_000);

  const created = await prisma.$transaction(async (tx) => {
    await tx.bookingSignature.updateMany({
      where: { bookingId, status: { in: OPENABLE } },
      data: { status: BookingSignatureStatus.REVOKED, revokedAt: new Date() },
    });

    return tx.bookingSignature.create({
      data: {
        bookingId,
        tokenHash: hashToken(token),
        recipientEmail,
        expiresAt,
        sentById: actorId,
      },
      select: { id: true },
    });
  });

  log.info({ bookingId, signatureId: created.id, actorId }, "Authorization link issued");

  return { id: created.id, token, expiresAt };
}

/** Everything the public signing page needs, and nothing it does not. */
export interface SignableBooking {
  signatureId: string;
  bookingNumber: string;
  customerName: string;
  customerEmail: string | null;
  contactPhone: string | null;
  product: string;
  totalMinor: number;
  currency: string;
  expiresAt: Date;
}

export type SignatureLookup =
  | { ok: true; booking: SignableBooking }
  | { ok: false; reason: "unknown" | "expired" | "revoked" | "signed" };

/**
 * Resolves a raw token to the booking behind it.
 *
 * Marks the row VIEWED on the first successful read, which is why this is not
 * a pure query. Knowing the customer opened the link but did not sign is the
 * difference between "they declined" and "it went to spam", and it is the only
 * moment at which that can be observed.
 *
 * Failure reasons are returned rather than thrown so the page can word each
 * one for a customer. None of them leaks booking detail.
 */
export async function findSignatureByToken(token: string): Promise<SignatureLookup> {
  if (token.trim() === "") return { ok: false, reason: "unknown" };

  const row = await prisma.bookingSignature.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      viewedAt: true,
      booking: {
        select: {
          bookingNumber: true,
          product: true,
          totalMinor: true,
          currency: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
          customer: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      },
    },
  });

  if (!row) return { ok: false, reason: "unknown" };
  if (row.status === BookingSignatureStatus.SIGNED) return { ok: false, reason: "signed" };
  if (row.status === BookingSignatureStatus.REVOKED) return { ok: false, reason: "revoked" };

  if (row.expiresAt.getTime() <= Date.now()) {
    // Recorded rather than merely reported, so the booking page shows why the
    // link stopped working instead of still offering it as outstanding.
    if (row.status !== BookingSignatureStatus.EXPIRED) {
      await prisma.bookingSignature.update({
        where: { id: row.id },
        data: { status: BookingSignatureStatus.EXPIRED },
      });
    }
    return { ok: false, reason: "expired" };
  }

  if (row.status === BookingSignatureStatus.EXPIRED) {
    return { ok: false, reason: "expired" };
  }

  if (!row.viewedAt) {
    await prisma.bookingSignature.update({
      where: { id: row.id },
      data: { status: BookingSignatureStatus.VIEWED, viewedAt: new Date() },
    });
  }

  const { booking } = row;
  const contactName =
    booking.contactName?.trim() ||
    `${booking.customer.firstName} ${booking.customer.lastName}`.trim();

  return {
    ok: true,
    booking: {
      signatureId: row.id,
      bookingNumber: booking.bookingNumber,
      customerName: contactName,
      customerEmail: booking.contactEmail ?? booking.customer.email,
      contactPhone: booking.contactPhone ?? booking.customer.phone,
      product: booking.product,
      totalMinor: booking.totalMinor,
      currency: booking.currency,
      expiresAt: row.expiresAt,
    },
  };
}

/** What the browser claims about itself. Corroboration, never proof. */
export interface ClientClaims {
  signatureName: string;
  signedPhone: string;
  consentText: string;
  device?: string | undefined;
  operatingSystem?: string | undefined;
  browser?: string | undefined;
  screenSize?: string | undefined;
  clientTimezone?: string | undefined;
}

export interface RecordSignatureInput {
  token: string;
  claims: ClientClaims;
  /** Observed by the server from the request, not supplied by the page. */
  ipAddress: string | null;
  userAgent: string | null;
}

export type RecordSignatureResult =
  | { ok: true; bookingId: string }
  | { ok: false; reason: "unknown" | "expired" | "revoked" | "signed" };

/**
 * Captures a signature against a token.
 *
 * The geolocation lookup runs before the transaction on purpose: it is an
 * outbound HTTP call, and holding a row lock open across one would make a slow
 * third party into this application's problem. The same reasoning keeps the
 * confirmation email outside the status transaction in
 * `booking-status-service.ts`.
 *
 * The status guard is re-read inside the transaction rather than trusted from
 * the page, so two submissions racing from a double-tapped button cannot both
 * write a signature.
 */
export async function recordSignature({
  token,
  claims,
  ipAddress,
  userAgent,
}: RecordSignatureInput): Promise<RecordSignatureResult> {
  const tokenHash = hashToken(token);
  const location = await lookupIp(ipAddress);

  const outcome = await prisma.$transaction(async (tx) => {
    const row = await tx.bookingSignature.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        bookingId: true,
        booking: { select: { bookingNumber: true } },
      },
    });

    if (!row) return { ok: false as const, reason: "unknown" as const };
    if (row.status === BookingSignatureStatus.SIGNED) {
      return { ok: false as const, reason: "signed" as const };
    }
    if (row.status === BookingSignatureStatus.REVOKED) {
      return { ok: false as const, reason: "revoked" as const };
    }
    if (
      row.status === BookingSignatureStatus.EXPIRED ||
      row.expiresAt.getTime() <= Date.now()
    ) {
      return { ok: false as const, reason: "expired" as const };
    }

    await tx.bookingSignature.update({
      where: { id: row.id },
      data: {
        status: BookingSignatureStatus.SIGNED,
        // The server's clock, not the browser's. A client timestamp is a claim
        // like any other and is not what the evidence rests on.
        signedAt: new Date(),
        signatureName: claims.signatureName,
        signedPhone: claims.signedPhone,
        consentText: claims.consentText,
        ipAddress,
        userAgent,
        device: claims.device ?? null,
        operatingSystem: claims.operatingSystem ?? null,
        browser: claims.browser ?? null,
        screenSize: claims.screenSize ?? null,
        clientTimezone: claims.clientTimezone ?? null,
        geoCity: location?.city ?? null,
        geoRegion: location?.region ?? null,
        geoCountry: location?.country ?? null,
        geoProvider: location?.provider ?? null,
        // Round-tripped through JSON so an exotic value from a third party
        // cannot fail the write on a type Prisma will not accept.
        geoRaw: location
          ? (JSON.parse(JSON.stringify(location.raw)) as Prisma.InputJsonObject)
          : undefined,
      },
    });

    // Tied to this transaction, so the trail cannot claim a signature that
    // rolled back.
    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "BookingSignature",
        entityId: row.id,
        // No administrator acted: the customer did, from a public link. A
        // null actor is the honest record of that.
        adminUserId: null,
        summary: `Customer signed the authorization for booking ${row.booking.bookingNumber}`,
        changes: {
          status: { before: row.status, after: BookingSignatureStatus.SIGNED },
        },
      },
      tx,
    );

    return { ok: true as const, bookingId: row.bookingId };
  });

  if (outcome.ok) {
    log.info({ bookingId: outcome.bookingId, ipAddress }, "Booking authorization signed");
  }

  return outcome;
}

/** Every authorization attempt for a booking, newest first. */
export function getBookingSignatures(bookingId: string) {
  return prisma.bookingSignature.findMany({
    where: { bookingId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      recipientEmail: true,
      sentAt: true,
      expiresAt: true,
      viewedAt: true,
      signedAt: true,
      signatureName: true,
      signedPhone: true,
      consentText: true,
      ipAddress: true,
      device: true,
      operatingSystem: true,
      browser: true,
      screenSize: true,
      clientTimezone: true,
      geoCity: true,
      geoRegion: true,
      geoCountry: true,
      sentBy: { select: { id: true, name: true } },
    },
  });
}

export type BookingSignatureRow = Awaited<
  ReturnType<typeof getBookingSignatures>
>[number];

/**
 * Whether the customer has authorized this booking.
 *
 * The gate on sending an e-ticket. Deliberately a query rather than a cached
 * flag on Booking: a denormalised boolean is one more thing that can disagree
 * with the rows it summarises, and this is checked a handful of times a day.
 */
export async function hasSignedAuthorization(bookingId: string): Promise<boolean> {
  const signed = await prisma.bookingSignature.findFirst({
    where: { bookingId, status: BookingSignatureStatus.SIGNED },
    select: { id: true },
  });

  return signed !== null;
}
