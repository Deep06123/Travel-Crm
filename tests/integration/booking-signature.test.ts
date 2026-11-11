import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { flushPendingAdminNotices } from "@/server/services/admin-notification-service";
import { sendAuthorizationEmail } from "@/server/services/booking-authorization-service";
import {
  createSignatureRequest,
  findSignatureByToken,
  hasSignedAuthorization,
  recordSignature,
} from "@/server/services/booking-signature-service";
import { createFlightBooking } from "@/server/services/booking-service";
import {
  deliverSignatureConfirmation,
  flushPendingSignatureConfirmations,
} from "@/server/services/signature-confirmation-service";
import { resetMailAccountCache } from "@/server/services/mail-account-service";
import { resetStorageCache } from "@/lib/storage";

import {
  restoreMailAccounts,
  suspendMailAccounts,
  type SuspendedAccounts,
} from "../helpers/mail-accounts";
import {
  restoreAdminNoticeSetting,
  setAdminNoticeEmails,
  takeAdminNoticeSetting,
  type SavedNoticeSetting,
} from "../helpers/admin-notices";
import { SmtpSink, decodeQuotedPrintable } from "../helpers/smtp-sink";
import { pdfText } from "../helpers/pdf-text";

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
let savedNotices: SavedNoticeSetting = null;
let suspendedAccounts: SuspendedAccounts = [];
let storageRoot = "";
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

  // The signed confirmation PDF is written through the storage adapter, so
  // this file needs somewhere real to put it. A temporary directory rather
  // than whatever the developer's `.env` points at: these are throwaway bytes
  // and must not land in a blob store or beside genuine documents.
  storageRoot = await mkdtemp(join(tmpdir(), "signature-pdf-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_ROOT = storageRoot;

  // One trusted proxy, matching the production shape the route is written for.
  process.env.TRUSTED_PROXY_HOPS = "1";

  resetEnvCache();
  resetMailerCache();
  resetStorageCache();

  // Off for the file, so every assertion about what crossed the socket is
  // about the customer's message. The one test that is *about* the internal
  // notice switches it on for itself.
  savedNotices = await takeAdminNoticeSetting();

  // And likewise any sending account configured in Settings: `resolveMailer`
  // prefers one over the SMTP_* variables set above, which would send this
  // file's assertions through somebody else's mailbox.
  suspendedAccounts = await suspendMailAccounts();

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

afterEach(async () => {
  // A notice dispatched by the test that just ended is still in flight, and
  // would otherwise land in the next test's sink.
  await flushPendingAdminNotices();
  await flushPendingSignatureConfirmations();
  sink.reset();
});

afterAll(async () => {
  await restoreAdminNoticeSetting(savedNotices);
  await restoreMailAccounts(suspendedAccounts);
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
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
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

    // The booking number comes back alongside the id because the internal
    // notice is addressed to people who know bookings by number, not by cuid.
    expect(outcome).toMatchObject({ ok: true, bookingId });

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

describe("internal notifications", () => {
  /**
   * The office's copy of what the customer was sent.
   *
   * Asserted on the wire rather than on the Notification row, because the
   * failure that matters is a notice that is recorded and never delivered —
   * and because the one thing it must never become is a second copy of the
   * customer's document. The passport number is the canary: it is not even
   * loaded for the customer's email, and it must not appear here either.
   */
  const OFFICE = "ops@example.invalid";

  it("copies the office when the authorization email is sent", async () => {
    await setAdminNoticeEmails([OFFICE]);
    const bookingId = await makeBooking();

    await sendAuthorizationEmail({
      bookingId,
      actorId,
      origin: "https://crm.example.invalid",
    });

    await flushPendingAdminNotices();

    const notice = sink.messages.find((message) =>
      message.recipients.includes(OFFICE),
    );

    expect(notice).toBeDefined();

    const body = decodeQuotedPrintable(notice!.data);
    expect(body).toContain("Authorization email sent");
    expect(body).toContain("Signature Test Actor");
    // A notice, not the document: no itinerary and no traveller data.
    expect(body).not.toContain("X1234567");
    expect(body).not.toContain("CLICK TO CONFIRM");

    const row = await prisma.notification.findFirst({
      where: { bookingId, eventType: "ADMIN_AUTHORIZATION_SENT" },
      select: { status: true, recipient: true, dedupeKey: true },
    });

    expect(row?.status).toBe(NotificationStatus.SENT);
    expect(row?.recipient).toBe(OFFICE);
    // Null, so a second authorization email gets a second notice.
    expect(row?.dedupeKey).toBeNull();

    await setAdminNoticeEmails([]);
  });

  it("copies the office when the customer signs", async () => {
    await setAdminNoticeEmails([OFFICE]);
    const bookingId = await makeBooking();
    const { token } = await createSignatureRequest(
      bookingId,
      "someone@example.invalid",
      actorId,
    );

    sink.reset();

    await recordSignature({
      token,
      claims: CLAIMS,
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });

    await flushPendingAdminNotices();

    const notice = sink.messages.find((message) =>
      message.recipients.includes(OFFICE),
    );

    expect(notice).toBeDefined();

    const body = decodeQuotedPrintable(notice!.data);
    expect(body).toContain("Customer signed the authorization");
    expect(body).toContain("Grace Hopper");
    expect(body).toContain("203.0.113.5");

    await setAdminNoticeEmails([]);
  });

  it("sends nothing and records nothing when no address is configured", async () => {
    await setAdminNoticeEmails([]);
    const bookingId = await makeBooking();

    await sendAuthorizationEmail({
      bookingId,
      actorId,
      origin: "https://crm.example.invalid",
    });

    await flushPendingAdminNotices();

    // Only the customer's own message crossed the socket.
    expect(sink.messages).toHaveLength(1);

    const rows = await prisma.notification.count({
      where: { bookingId, eventType: "ADMIN_AUTHORIZATION_SENT" },
    });

    // Deliberately not even a SUPPRESSED row: a deployment that wants no
    // internal copies must not accumulate one per customer email saying so.
    expect(rows).toBe(0);
  });
});

/**
 * The signed authorization going back to the mailbox that asked for it.
 *
 * Asserted against the bytes on the socket and the rows in the database, like
 * everything else in this file. The destination is the property under test:
 * it must come from what was captured when the invitation went out, never
 * from whichever account happens to be the default when the customer signs.
 */
describe("the signature confirmation", () => {
  /** The attachment, decoded back into the PDF it was before transfer. */
  function attachedPdf(raw: string): Buffer {
    const start = raw.indexOf("application/pdf");
    expect(start).toBeGreaterThan(-1);

    // Headers, then a blank line, then base64 until the next MIME boundary.
    const bodyStart = raw.indexOf("\r\n\r\n", start) + 4;
    const end = raw.indexOf("\r\n--", bodyStart);

    return Buffer.from(
      raw.slice(bodyStart, end === -1 ? undefined : end).replace(/\s+/g, ""),
      "base64",
    );
  }

  /** Signs a fresh booking and waits for the dispatched confirmation. */
  async function signBooking(): Promise<{ bookingId: string; signatureId: string }> {
    const bookingId = await makeBooking();

    await sendAuthorizationEmail({
      bookingId,
      actorId,
      origin: "https://crm.example.invalid",
    });

    const row = await prisma.bookingSignature.findFirstOrThrow({
      where: { bookingId },
      select: { id: true },
    });

    // The token never leaves `createSignatureRequest`, and the one minted by
    // the send above is in the email. Issuing a second here would revoke it,
    // so the row is signed through the service with a token of its own.
    const { token, id: signatureId } = await createSignatureRequest(
      bookingId,
      `sign-customer-${SUFFIX}@example.invalid`,
      actorId,
      { email: "bookings@example.invalid", accountId: null },
    );

    expect(signatureId).not.toBe(row.id);

    await findSignatureByToken(token);
    sink.reset();

    const outcome = await recordSignature({
      token,
      claims: CLAIMS,
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });

    expect(outcome).toMatchObject({ ok: true });

    await flushPendingSignatureConfirmations();

    return { bookingId, signatureId };
  }

  it("captures the sending address when the invitation goes out", async () => {
    const bookingId = await makeBooking();

    await sendAuthorizationEmail({
      bookingId,
      actorId,
      origin: "https://crm.example.invalid",
    });

    const row = await prisma.bookingSignature.findFirstOrThrow({
      where: { bookingId },
      select: { senderEmail: true, senderMailAccountId: true },
    });

    // Taken from MAIL_FROM, with the display name stripped: the address is
    // what a later message is sent back to, and the name beside it is a label.
    expect(row.senderEmail).toBe("bookings@example.invalid");
    expect(row.senderMailAccountId).toBeNull();
  });

  it("reads as the customer and replies to them, while still being sent as us", async () => {
    await signBooking();

    const message = sink.messages.find((entry) =>
      entry.recipients.includes("bookings@example.invalid"),
    );

    expect(message).toBeDefined();

    // The envelope sender — what a bounce returns to, and what SPF and DKIM
    // are checked against — is ours. Sending as the customer's own address
    // would fail DMARC at any recipient domain that publishes a policy.
    expect(message!.from).toBe("bookings@example.invalid");

    // What the office sees in the inbox: the customer's name over our address.
    expect(message!.data).toContain(
      'From: "Grace Hopper (customer)" <bookings@example.invalid>',
    );

    // And pressing Reply writes to the customer, not back to the office.
    expect(message!.data).toContain(
      `Reply-To: sign-customer-${SUFFIX}@example.invalid`,
    );
  });

  it("emails the captured sender the consent wording, the evidence and the PDF", async () => {
    const { signatureId } = await signBooking();

    const message = sink.messages.find((entry) =>
      entry.recipients.includes("bookings@example.invalid"),
    );

    expect(message).toBeDefined();

    const body = decodeQuotedPrintable(message!.data);

    // Verbatim, because this is the sentence a dispute turns on.
    expect(body).toContain(CLAIMS.consentText);

    // Everything the signing page said would be recorded.
    expect(body).toContain("203.0.113.5");
    expect(body).toContain("Windows PC");
    expect(body).toContain("Win32");
    expect(body).toContain("Google Chrome");
    expect(body).toContain("1920 x 1080");
    expect(body).toContain("Europe/London");
    expect(body.toLowerCase()).toContain("customer security information");

    // And the document itself, not merely a claim that one exists.
    const pdf = attachedPdf(message!.data);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const drawn = pdfText(pdf);
    expect(drawn).toContain("203.0.113.5");
    expect(drawn).toContain("Google Chrome");
    expect(drawn.replace(/\s+/g, " ")).toContain(CLAIMS.consentText);

    const stored = await prisma.bookingSignature.findUniqueOrThrow({
      where: { id: signatureId },
      select: { confirmationPdfKey: true },
    });

    expect(stored.confirmationPdfKey).toBeTruthy();
  });

  it("records the delivery against the booking, under a key unique to the signature", async () => {
    const { bookingId, signatureId } = await signBooking();

    const row = await prisma.notification.findFirstOrThrow({
      where: { bookingId, eventType: "BOOKING_AUTHORIZATION_CONFIRMATION" },
      select: {
        status: true,
        recipient: true,
        template: true,
        sentAt: true,
        dedupeKey: true,
        attemptCount: true,
      },
    });

    expect(row.status).toBe(NotificationStatus.SENT);
    expect(row.recipient).toBe("bookings@example.invalid");
    expect(row.template).toBe("signature-confirmation");
    expect(row.sentAt).not.toBeNull();
    expect(row.attemptCount).toBe(1);
    expect(row.dedupeKey).toBe(`signature:${signatureId}:confirmation`);
  });

  it("sends exactly one copy however many times delivery is attempted", async () => {
    const { bookingId, signatureId } = await signBooking();
    sink.reset();

    // Two more attempts, concurrently — the shape a double-tapped retry or a
    // second application instance would produce.
    const [a, b] = await Promise.all([
      deliverSignatureConfirmation(signatureId),
      deliverSignatureConfirmation(signatureId),
    ]);

    expect(a).toEqual({ result: "duplicate" });
    expect(b).toEqual({ result: "duplicate" });
    expect(sink.messages).toHaveLength(0);

    const rows = await prisma.notification.count({
      where: { bookingId, eventType: "BOOKING_AUTHORIZATION_CONFIRMATION" },
    });

    expect(rows).toBe(1);
  });

  it("does not fail the signature when the confirmation cannot be sent", async () => {
    const bookingId = await makeBooking();
    const { token, id } = await createSignatureRequest(
      bookingId,
      `sign-customer-${SUFFIX}@example.invalid`,
      actorId,
      { email: "bookings@example.invalid", accountId: null },
    );

    // Every recipient refused. The signature is committed before the
    // confirmation is attempted and must stand regardless.
    sink.rejectRecipients = true;

    const outcome = await recordSignature({
      token,
      claims: CLAIMS,
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });

    await flushPendingSignatureConfirmations();
    sink.rejectRecipients = false;

    expect(outcome).toMatchObject({ ok: true });

    const signature = await prisma.bookingSignature.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(signature.status).toBe(BookingSignatureStatus.SIGNED);

    // And the failure is accounted for rather than swallowed.
    const row = await prisma.notification.findFirstOrThrow({
      where: { bookingId, eventType: "BOOKING_AUTHORIZATION_CONFIRMATION" },
      select: { status: true, lastError: true, sentAt: true, attemptCount: true },
    });

    expect(row.status).toBe(NotificationStatus.FAILED);
    expect(row.lastError).toBeTruthy();
    expect(row.sentAt).toBeNull();
    expect(row.attemptCount).toBe(1);
  });

  it("retries a failed confirmation and reuses the document already rendered", async () => {
    const bookingId = await makeBooking();
    const { token, id } = await createSignatureRequest(
      bookingId,
      `sign-customer-${SUFFIX}@example.invalid`,
      actorId,
      { email: "bookings@example.invalid", accountId: null },
    );

    sink.rejectRecipients = true;
    await recordSignature({
      token,
      claims: CLAIMS,
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });
    await flushPendingSignatureConfirmations();
    sink.rejectRecipients = false;

    const afterFailure = await prisma.bookingSignature.findUniqueOrThrow({
      where: { id },
      select: { confirmationPdfKey: true },
    });

    // The PDF was rendered and stored before the send was attempted, so a
    // retry has something to reuse.
    expect(afterFailure.confirmationPdfKey).toBeTruthy();

    sink.reset();

    const retried = await deliverSignatureConfirmation(id, { retry: true });

    expect(retried).toMatchObject({
      result: "sent",
      recipient: "bookings@example.invalid",
    });
    expect(sink.messages).toHaveLength(1);

    const afterRetry = await prisma.bookingSignature.findUniqueOrThrow({
      where: { id },
      select: { confirmationPdfKey: true },
    });

    // The same object, not a second rendering: two versions of one piece of
    // evidence is a question nobody wants to answer.
    expect(afterRetry.confirmationPdfKey).toBe(afterFailure.confirmationPdfKey);

    const row = await prisma.notification.findFirstOrThrow({
      where: { bookingId, eventType: "BOOKING_AUTHORIZATION_CONFIRMATION" },
      select: { status: true, attemptCount: true, lastError: true },
    });

    expect(row.status).toBe(NotificationStatus.SENT);
    expect(row.attemptCount).toBe(2);
    // Cleared, so the booking page does not keep showing an error that no
    // longer describes the state.
    expect(row.lastError).toBeNull();
  });

  it("refuses to retry a confirmation that was already delivered", async () => {
    const { signatureId } = await signBooking();
    sink.reset();

    await expect(
      deliverSignatureConfirmation(signatureId, { retry: true }),
    ).resolves.toEqual({ result: "duplicate" });

    expect(sink.messages).toHaveLength(0);
  });

  it("refuses to confirm an authorization that has not been signed", async () => {
    const bookingId = await makeBooking();
    const { id } = await createSignatureRequest(
      bookingId,
      `sign-customer-${SUFFIX}@example.invalid`,
      actorId,
      { email: "bookings@example.invalid", accountId: null },
    );

    sink.reset();

    const outcome = await deliverSignatureConfirmation(id);

    expect(outcome).toMatchObject({ result: "suppressed" });
    expect(sink.messages).toHaveLength(0);
  });

  it("suppresses rather than guesses when no sender was captured", async () => {
    const bookingId = await makeBooking();

    // An invitation issued before senders were captured, or on a machine with
    // no transport at all.
    const { token, id } = await createSignatureRequest(
      bookingId,
      `sign-customer-${SUFFIX}@example.invalid`,
      actorId,
    );

    sink.reset();

    await recordSignature({
      token,
      claims: CLAIMS,
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });

    await flushPendingSignatureConfirmations();

    // Nothing was sent to today's default account, which never asked for it.
    expect(sink.messages).toHaveLength(0);

    const row = await prisma.notification.findFirstOrThrow({
      where: { bookingId, eventType: "BOOKING_AUTHORIZATION_CONFIRMATION" },
      select: { status: true, lastError: true, dedupeKey: true },
    });

    expect(row.status).toBe(NotificationStatus.SUPPRESSED);
    expect(row.lastError).toMatch(/no sender address/i);
    expect(row.dedupeKey).toBe(`signature:${id}:confirmation`);
  });

  it("sends through the configured account that issued the invitation", async () => {
    // The primary path, and the one the whole feature turns on: a deployment
    // with sending accounts in Settings, where the confirmation must go back
    // through the identity that asked for the signature rather than through
    // whatever the environment happens to be configured with.
    const account = await prisma.mailAccount.create({
      data: {
        label: `Reservations ${SUFFIX}`,
        fromEmail: "reservations@example.invalid",
        fromName: "Reservations",
        // The same loopback sink the environment fallback uses, so the send is
        // real and the assertion is still about what crossed the socket.
        host: "127.0.0.1",
        port: Number(process.env.SMTP_PORT),
        secure: false,
        isActive: true,
      },
      select: { id: true },
    });
    resetMailAccountCache();

    try {
      const bookingId = await makeBooking();
      const { token, id } = await createSignatureRequest(
        bookingId,
        `sign-customer-${SUFFIX}@example.invalid`,
        actorId,
        { email: "reservations@example.invalid", accountId: account.id },
      );

      sink.reset();

      await recordSignature({
        token,
        claims: CLAIMS,
        ipAddress: "203.0.113.5",
        userAgent: "Mozilla/5.0 (Windows NT 10.0)",
      });

      await flushPendingSignatureConfirmations();

      const message = sink.messages.find((entry) =>
        entry.recipients.includes("reservations@example.invalid"),
      );

      expect(message).toBeDefined();

      // From the account's own identity, not `MAIL_FROM`. The envelope sender
      // is what a bounce comes back to, so it is the part that matters.
      expect(message!.from).toBe("reservations@example.invalid");
      // The header carries the account's address under the customer's name —
      // the account's own display name gives way to it. See the reply-to test.
      expect(message!.data).toContain(
        '"Grace Hopper (customer)" <reservations@example.invalid>',
      );

      const body = decodeQuotedPrintable(message!.data);
      expect(body).toContain(CLAIMS.consentText);
      expect(body).toContain("203.0.113.5");

      // The document still goes with it when an account is in play.
      expect(attachedPdf(message!.data).subarray(0, 5).toString("latin1")).toBe(
        "%PDF-",
      );

      const row = await prisma.notification.findFirstOrThrow({
        where: { bookingId, eventType: "BOOKING_AUTHORIZATION_CONFIRMATION" },
        select: { status: true, recipient: true, mailAccountId: true },
      });

      expect(row.status).toBe(NotificationStatus.SENT);
      expect(row.recipient).toBe("reservations@example.invalid");
      // Attributed to the account that sent it, so the delivery history says
      // which mailbox this went through.
      expect(row.mailAccountId).toBe(account.id);

      const signature = await prisma.bookingSignature.findUniqueOrThrow({
        where: { id },
        select: { senderMailAccountId: true },
      });
      expect(signature.senderMailAccountId).toBe(account.id);
    } finally {
      // Deleted in a `finally`: an active account left behind would be picked
      // up by `resolveMailer` for every later test in this file.
      await prisma.mailAccount.delete({ where: { id: account.id } });
      resetMailAccountCache();
    }
  });

  it("still delivers when the account that sent the invitation has been deleted", async () => {
    const account = await prisma.mailAccount.create({
      data: {
        label: `Retired ${SUFFIX}`,
        fromEmail: "retired@example.invalid",
        host: "127.0.0.1",
        port: 1,
        secure: false,
        // Inactive, so it cannot be picked up by any other test in this file.
        isActive: false,
      },
      select: { id: true },
    });

    const bookingId = await makeBooking();
    const { token, id } = await createSignatureRequest(
      bookingId,
      `sign-customer-${SUFFIX}@example.invalid`,
      actorId,
      { email: "retired@example.invalid", accountId: account.id },
    );

    // Deleted after the invitation went out. `SetNull` keeps the signature.
    await prisma.mailAccount.delete({ where: { id: account.id } });
    resetMailAccountCache();

    sink.reset();

    await recordSignature({
      token,
      claims: CLAIMS,
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });

    await flushPendingSignatureConfirmations();

    const signature = await prisma.bookingSignature.findUniqueOrThrow({
      where: { id },
      select: { senderEmail: true, senderMailAccountId: true },
    });

    // The evidence survives the deletion, and still names the mailbox.
    expect(signature.senderMailAccountId).toBeNull();
    expect(signature.senderEmail).toBe("retired@example.invalid");

    // Sent through the environment fallback, to the address that was captured
    // rather than to the fallback's own.
    const message = sink.messages.find((entry) =>
      entry.recipients.includes("retired@example.invalid"),
    );

    expect(message).toBeDefined();

    const row = await prisma.notification.findFirstOrThrow({
      where: { bookingId, eventType: "BOOKING_AUTHORIZATION_CONFIRMATION" },
      select: { status: true, recipient: true },
    });

    expect(row.status).toBe(NotificationStatus.SENT);
    expect(row.recipient).toBe("retired@example.invalid");
  });

  it("writes one confirmation when the same link is submitted twice at once", async () => {
    const bookingId = await makeBooking();
    const { token } = await createSignatureRequest(
      bookingId,
      `sign-customer-${SUFFIX}@example.invalid`,
      actorId,
      { email: "bookings@example.invalid", accountId: null },
    );

    sink.reset();

    // A double-tapped button: two requests, one token.
    const input = {
      token,
      claims: CLAIMS,
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    };

    const outcomes = await Promise.all([
      recordSignature(input),
      recordSignature(input),
    ]);

    await flushPendingSignatureConfirmations();

    // Exactly one signature, and exactly one confirmation behind it.
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);

    const rows = await prisma.notification.count({
      where: { bookingId, eventType: "BOOKING_AUTHORIZATION_CONFIRMATION" },
    });

    expect(rows).toBe(1);

    const confirmations = sink.messages.filter((entry) =>
      entry.recipients.includes("bookings@example.invalid"),
    );

    expect(confirmations).toHaveLength(1);
  });
});
