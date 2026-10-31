import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  BookingSignatureStatus,
  CustomerStatus,
  NotificationStatus,
  PassengerType,
  TicketStatus,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { resetEnvCache } from "@/lib/env";
import { resetMailerCache } from "@/lib/mail";
import { sendAuthorizationEmail } from "@/server/services/booking-authorization-service";
import {
  createSignatureRequest,
  findSignatureByToken,
  hasSignedAuthorization,
  recordSignature,
} from "@/server/services/booking-signature-service";
import { createFlightBooking } from "@/server/services/booking-service";

import { SmtpSink, decodeQuotedPrintable } from "../helpers/smtp-sink";

/**
 * Customer authorization: the emailed link, the signature it returns, and the
 * e-ticket gate it opens.
 *
 * Run against the real database and a real SMTP server on loopback, so what is
 * asserted is the row that was written and the message that crossed a socket.
 * The token is deliberately never read back out of the database — it exists in
 * the return value and in the email, which is the whole security property.
 */

const SUFFIX = Date.now();
const sink = new SmtpSink();

let actorId: string;
let customerId: string;
const bookingIds: string[] = [];

const CLAIMS = {
  signatureName: "Grace Hopper",
  signedPhone: "+1 555 0100",
  consentText: "I confirm that I have reviewed the booking details.",
  device: "Windows PC",
  operatingSystem: "Win32",
  browser: "Google Chrome",
  screenSize: "1920 x 1080",
  clientTimezone: "Europe/London",
};

async function makeBooking(
  overrides: { contactEmail?: string | null } = {},
): Promise<string> {
  const { id } = await createFlightBooking(
    {
      booking: {
        customerId,
        ticketStatus: TicketStatus.PENDING,
        mcoStatus: "NOT_APPLICABLE",
        currency: "USD",
        splitCharges: false,
        airlineConfirmation: "ABC123",
        contactPhone: "+1 555 0199",
        cardHolderName: "Grace Hopper",
        cardType: "VISA",
        cardLast4: "1111",
        billingCity: "Leeds",
        billingCountry: "United Kingdom",
        ...(overrides.contactEmail === undefined
          ? {}
          : { contactEmail: overrides.contactEmail }),
      } as never,
      amounts: {
        baseFareMinor: 90_000,
        taxesFeesMinor: 12_997,
        totalMinor: 102_997,
        supplierCostMinor: 92_697,
        grossMcoMinor: 0,
        netMcoMinor: 0,
      },
      passengers: [
        {
          firstName: "Ada",
          lastName: "Lovelace",
          type: PassengerType.ADULT,
          passportNumber: "X1234567",
        } as never,
      ],
      segments: [
        {
          airline: "Delta",
          flightNumber: "DL123",
          origin: "JFK",
          destination: "LHR",
          departureAt: new Date("2027-03-01T18:00:00Z"),
          arrivalAt: new Date("2027-03-02T06:00:00Z"),
        } as never,
      ],
    },
    actorId,
  );

  bookingIds.push(id);
  return id;
}

beforeAll(async () => {
  const port = await sink.start();

  process.env.MAIL_DRIVER = "smtp";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(port);
  process.env.SMTP_SECURE = "false";
  process.env.MAIL_FROM = "Travel CRM <bookings@example.invalid>";
  process.env.AUTH_URL = "https://crm.example.invalid";
  // Left off deliberately: an unconfigured provider is a supported
  // configuration, and the signature must record cleanly without one.
  process.env.GEOIP_PROVIDER = "none";
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;

  resetEnvCache();
  resetMailerCache();

  const actor = await prisma.adminUser.create({
    data: {
      email: `sign-test-${SUFFIX}@example.invalid`,
      name: "Signature Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  });
  actorId = actor.id;

  const customer = await prisma.customer.create({
    data: {
      reference: `CUS-SIGN-${SUFFIX}`,
      firstName: "Grace",
      lastName: "Hopper",
      email: `sign-customer-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
    },
    select: { id: true },
  });
  customerId = customer.id;
});

afterEach(() => {
  sink.reset();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  await prisma.auditLog.deleteMany({ where: { entityType: "BookingSignature" } });
  await prisma.notification.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });
  // BookingSignature cascades from Booking, so it needs no delete of its own.
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.adminUser.deleteMany({ where: { id: actorId } });
  await sink.stop();
  await prisma.$disconnect();
});

describe("sending the authorization email", () => {
  it("emails the customer a working link and records the send", async () => {
    const bookingId = await makeBooking();

    const outcome = await sendAuthorizationEmail({
      bookingId,
      actorId,
      origin: "https://crm.example.invalid",
    });

    expect(outcome.result).toBe("sent");

    const message = decodeQuotedPrintable(sink.only().data);
    expect(message).toContain("CLICK TO CONFIRM");
    expect(message).toContain("Credit Card Authorization Details");
    // Brand and last four only; the PAN is never submitted, so it cannot be here.
    expect(message).toContain("1111");
    // Nothing internal may reach a customer mailbox.
    expect(message).not.toContain("X1234567");
    expect(message).not.toContain("92697");

    const notification = await prisma.notification.findFirst({
      where: { bookingId, eventType: "BOOKING_AUTHORIZATION" },
      select: { status: true, dedupeKey: true, recipient: true },
    });

    expect(notification?.status).toBe(NotificationStatus.SENT);
    // Null, so a resend is a second message rather than a unique-key clash.
    expect(notification?.dedupeKey).toBeNull();

    const row = await prisma.bookingSignature.findFirst({
      where: { bookingId },
      select: { status: true, recipientEmail: true, sentById: true },
    });

    expect(row?.status).toBe(BookingSignatureStatus.SENT);
    expect(row?.sentById).toBe(actorId);
    expect(row?.recipientEmail).toBe(notification?.recipient);
  });

  it("suppresses rather than fails when there is nowhere to send", async () => {
    // Both addresses blank: the booking's own, and the customer it falls back to.
    const bookingId = await makeBooking({ contactEmail: null });
    await prisma.customer.update({
      where: { id: customerId },
      data: { email: null },
    });

    const outcome = await sendAuthorizationEmail({
      bookingId,
      actorId,
      origin: "https://crm.example.invalid",
    });

    expect(outcome.result).toBe("suppressed");
    expect(sink.messages).toHaveLength(0);

    // No token was minted for a message that never left.
    const count = await prisma.bookingSignature.count({ where: { bookingId } });
    expect(count).toBe(0);

    await prisma.customer.update({
      where: { id: customerId },
      data: { email: `sign-customer-${SUFFIX}@example.invalid` },
    });
  });

  it("revokes the previous link when a new one is sent", async () => {
    const bookingId = await makeBooking();

    const first = await createSignatureRequest(
      bookingId,
      "someone@example.invalid",
      actorId,
    );
    await createSignatureRequest(bookingId, "someone@example.invalid", actorId);

    // Two live tokens would let one authorization be signed twice.
    await expect(findSignatureByToken(first.token)).resolves.toMatchObject({
      ok: false,
      reason: "revoked",
    });
  });
});

describe("opening the signing link", () => {
  it("resolves the booking and marks it opened", async () => {
    const bookingId = await makeBooking();
    const { token } = await createSignatureRequest(
      bookingId,
      "someone@example.invalid",
      actorId,
    );

    const lookup = await findSignatureByToken(token);

    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;

    expect(lookup.booking.totalMinor).toBe(102_997);
    expect(lookup.booking.customerName).toBe("Grace Hopper");
    // Prefills the field the customer confirms.
    expect(lookup.booking.contactPhone).toBe("+1 555 0199");

    const row = await prisma.bookingSignature.findFirst({
      where: { bookingId },
      select: { status: true, viewedAt: true },
    });

    expect(row?.status).toBe(BookingSignatureStatus.VIEWED);
    expect(row?.viewedAt).not.toBeNull();
  });

  it("refuses an unknown token without saying anything about a booking", async () => {
    await expect(
      findSignatureByToken("not-a-real-token"),
    ).resolves.toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses an expired token and records the expiry", async () => {
    const bookingId = await makeBooking();
    const { id, token } = await createSignatureRequest(
      bookingId,
      "someone@example.invalid",
      actorId,
    );

    await prisma.bookingSignature.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(findSignatureByToken(token)).resolves.toEqual({
      ok: false,
      reason: "expired",
    });

    const row = await prisma.bookingSignature.findUnique({
      where: { id },
      select: { status: true },
    });
    expect(row?.status).toBe(BookingSignatureStatus.EXPIRED);
  });
});

describe("recording a signature", () => {
  it("stores the evidence and writes an audit entry", async () => {
    const bookingId = await makeBooking();
    const { id, token } = await createSignatureRequest(
      bookingId,
      "someone@example.invalid",
      actorId,
    );

    const outcome = await recordSignature({
      token,
      claims: CLAIMS,
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });

    expect(outcome).toEqual({ ok: true, bookingId });

    const row = await prisma.bookingSignature.findUnique({
      where: { id },
      select: {
        status: true,
        signedAt: true,
        signatureName: true,
        signedPhone: true,
        consentText: true,
        ipAddress: true,
        userAgent: true,
        device: true,
        browser: true,
        screenSize: true,
        clientTimezone: true,
        geoCountry: true,
      },
    });

    expect(row).toMatchObject({
      status: BookingSignatureStatus.SIGNED,
      signatureName: "Grace Hopper",
      signedPhone: "+1 555 0100",
      consentText: CLAIMS.consentText,
      // Observed by the server, not claimed by the page.
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
      device: "Windows PC",
      browser: "Google Chrome",
      screenSize: "1920 x 1080",
      clientTimezone: "Europe/London",
      // No provider configured, so the location stays null rather than failing.
      geoCountry: null,
    });
    expect(row?.signedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "BookingSignature", entityId: id },
      select: { action: true, adminUserId: true, summary: true },
    });

    expect(audit?.action).toBe("UPDATE");
    // The customer acted, not an administrator.
    expect(audit?.adminUserId).toBeNull();
    expect(audit?.summary).toContain("Customer signed");
  });

  it("refuses a second signature on the same token", async () => {
    const bookingId = await makeBooking();
    const { token } = await createSignatureRequest(
      bookingId,
      "someone@example.invalid",
      actorId,
    );

    await recordSignature({
      token,
      claims: CLAIMS,
      ipAddress: "203.0.113.5",
      userAgent: null,
    });

    await expect(
      recordSignature({
        token,
        claims: { ...CLAIMS, signatureName: "Someone Else" },
        ipAddress: "203.0.113.9",
        userAgent: null,
      }),
    ).resolves.toEqual({ ok: false, reason: "signed" });

    // The first signature stands; the second did not overwrite it.
    const row = await prisma.bookingSignature.findFirst({
      where: { bookingId },
      select: { signatureName: true, ipAddress: true },
    });
    expect(row).toMatchObject({
      signatureName: "Grace Hopper",
      ipAddress: "203.0.113.5",
    });
  });

  it("refuses an expired token", async () => {
    const bookingId = await makeBooking();
    const { id, token } = await createSignatureRequest(
      bookingId,
      "someone@example.invalid",
      actorId,
    );

    await prisma.bookingSignature.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(
      recordSignature({
        token,
        claims: CLAIMS,
        ipAddress: "203.0.113.5",
        userAgent: null,
      }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });
});

describe("the e-ticket gate", () => {
  it("is closed until a signature exists and stays open afterwards", async () => {
    const bookingId = await makeBooking();

    await expect(hasSignedAuthorization(bookingId)).resolves.toBe(false);

    const { token } = await createSignatureRequest(
      bookingId,
      "someone@example.invalid",
      actorId,
    );

    // An issued but unsigned link is not authorization.
    await expect(hasSignedAuthorization(bookingId)).resolves.toBe(false);

    await recordSignature({
      token,
      claims: CLAIMS,
      ipAddress: "203.0.113.5",
      userAgent: null,
    });

    await expect(hasSignedAuthorization(bookingId)).resolves.toBe(true);

    // A later send does not undo the signature already given.
    await createSignatureRequest(bookingId, "someone@example.invalid", actorId);
    await expect(hasSignedAuthorization(bookingId)).resolves.toBe(true);
  });
});
