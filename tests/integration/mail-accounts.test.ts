import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
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
import { createFlightBooking } from "@/server/services/booking-service";
import {
  createMailAccount,
  MAIL_DEFAULTS_SETTING_KEY,
  resetMailAccountCache,
  resolveMailer,
  savePurposeDefaults,
  updateMailAccount,
  verifyMailAccount,
} from "@/server/services/mail-account-service";

import {
  restoreMailAccounts,
  suspendMailAccounts,
  type SuspendedAccounts,
} from "../helpers/mail-accounts";
import {
  restoreAdminNoticeSetting,
  takeAdminNoticeSetting,
  type SavedNoticeSetting,
} from "../helpers/admin-notices";
import { SmtpSink } from "../helpers/smtp-sink";

/**
 * Sending accounts: the mailboxes an administrator configures in Settings.
 *
 * The property under test is that a configured account actually governs what
 * leaves the building — the envelope sender on the wire, and the row that says
 * which identity sent it. Asserting only that `resolveMailer` returns an
 * adapter would prove nothing: the bug worth catching is a message that goes
 * out from the wrong address, and the address is in the headers.
 *
 * A real SMTP server on loopback, as in the other mail files, so the
 * assertions are about bytes rather than about arguments handed to a mock.
 */

const SUFFIX = Date.now();
const sink = new SmtpSink();

let actorId: string;
let customerId: string;
let savedNotices: SavedNoticeSetting = null;
let suspendedAccounts: SuspendedAccounts = [];
let savedDefaults: unknown;
let port: number;

const bookingIds: string[] = [];
const accountIds: string[] = [];

/** Creates an account pointed at the sink, and remembers it for cleanup. */
async function makeAccount(
  label: string,
  fromEmail: string,
  overrides: { fromName?: string; password?: string; username?: string } = {},
): Promise<string> {
  const id = await createMailAccount(
    {
      label: `${label} ${SUFFIX}`,
      fromEmail,
      host: "127.0.0.1",
      port,
      secure: false,
      isActive: true,
      ...overrides,
    },
    actorId,
  );

  accountIds.push(id);
  return id;
}

async function makeBooking(): Promise<string> {
  const { id } = await createFlightBooking(
    {
      booking: {
        customerId,
        ticketStatus: TicketStatus.PENDING,
        mcoStatus: "NOT_APPLICABLE",
        currency: "USD",
        splitCharges: false,
        airlineConfirmation: "ABC123",
        contactEmail: `mail-account-customer-${SUFFIX}@example.invalid`,
        contactPhone: "+1 555 0199",
        cardHolderName: "Grace Hopper",
        cardType: "VISA",
        cardLast4: "1111",
        billingCity: "Leeds",
        billingCountry: "United Kingdom",
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
  port = await sink.start();

  // Deliberately pointed somewhere that is *not* the sink: every assertion
  // below about an account sending is then also an assertion that the
  // environment fallback was not what sent it.
  process.env.MAIL_DRIVER = "smtp";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1";
  process.env.SMTP_SECURE = "false";
  process.env.MAIL_FROM = "Fallback <fallback@example.invalid>";
  process.env.AUTH_URL = "https://crm.example.invalid";
  process.env.GEOIP_PROVIDER = "none";
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;

  resetEnvCache();
  resetMailerCache();

  savedNotices = await takeAdminNoticeSetting();
  suspendedAccounts = await suspendMailAccounts();

  const existingDefaults = await prisma.businessSetting.findUnique({
    where: { key: MAIL_DEFAULTS_SETTING_KEY },
    select: { value: true },
  });
  savedDefaults = existingDefaults?.value ?? null;

  const actor = await prisma.adminUser.create({
    data: {
      email: `mail-account-test-${SUFFIX}@example.invalid`,
      name: "Mail Account Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  });
  actorId = actor.id;

  const customer = await prisma.customer.create({
    data: {
      reference: `CUS-MAIL-${SUFFIX}`,
      firstName: "Grace",
      lastName: "Hopper",
      email: `mail-account-cust-${SUFFIX}@example.invalid`,
      status: CustomerStatus.ACTIVE,
    },
    select: { id: true },
  });
  customerId = customer.id;
});

afterEach(() => {
  sink.reset();
  resetMailAccountCache();
});

afterAll(async () => {
  await prisma.businessSetting.deleteMany({
    where: { key: MAIL_DEFAULTS_SETTING_KEY },
  });

  if (savedDefaults !== null) {
    await prisma.businessSetting.create({
      data: {
        key: MAIL_DEFAULTS_SETTING_KEY,
        value: savedDefaults as never,
      },
    });
  }

  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.mailAccount.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.adminUser.deleteMany({ where: { id: actorId } });

  await restoreAdminNoticeSetting(savedNotices);
  await restoreMailAccounts(suspendedAccounts);

  await sink.stop();
  await prisma.$disconnect();
});

describe("resolving which account sends", () => {
  it("prefers the account the operator picked for this send", async () => {
    const chosen = await makeAccount("Picked", "picked@example.invalid");
    await makeAccount("Other", "other@example.invalid");

    const resolved = await resolveMailer("authorization", chosen);

    expect(resolved?.accountId).toBe(chosen);

    await prisma.mailAccount.deleteMany({
      where: { id: { in: accountIds.splice(0) } },
    });
  });

  it("falls back to the purpose default when nothing was picked", async () => {
    const authorization = await makeAccount("Auth", "auth@example.invalid");
    const eticket = await makeAccount("Tickets", "tickets@example.invalid");

    await savePurposeDefaults(
      { authorization, eticket },
      actorId,
    );

    expect((await resolveMailer("authorization"))?.accountId).toBe(
      authorization,
    );
    expect((await resolveMailer("eticket"))?.accountId).toBe(eticket);

    await prisma.businessSetting.deleteMany({
      where: { key: MAIL_DEFAULTS_SETTING_KEY },
    });
    await prisma.mailAccount.deleteMany({
      where: { id: { in: accountIds.splice(0) } },
    });
  });

  it("ignores a disabled account and a default pointing at one", async () => {
    const id = await makeAccount("Retired", "retired@example.invalid");

    await prisma.mailAccount.update({
      where: { id },
      data: { isActive: false },
    });
    resetMailAccountCache();

    // No active account left, so this is the environment fallback — which is
    // the point: a disabled mailbox must not keep sending.
    expect((await resolveMailer("authorization"))?.accountId).toBeNull();

    // And it cannot be made the default in the first place.
    await expect(
      savePurposeDefaults({ authorization: id }, actorId),
    ).rejects.toThrow(/disabled/i);

    await prisma.mailAccount.deleteMany({
      where: { id: { in: accountIds.splice(0) } },
    });
  });
});

describe("sending from a configured account", () => {
  it("puts the account's address on the wire and records which sent it", async () => {
    const id = await makeAccount("Confirmations", "info@example.invalid", {
      fromName: "Cruise Confirmations",
    });

    const bookingId = await makeBooking();

    const outcome = await sendAuthorizationEmail({
      bookingId,
      actorId,
      origin: "https://crm.example.invalid",
      mailAccountId: id,
    });

    expect(outcome.result).toBe("sent");

    const captured = sink.only();

    // The envelope sender, as MAIL FROM gave it: the account's address, not
    // the MAIL_FROM in the environment.
    expect(captured.from).toBe("info@example.invalid");
    expect(captured.data).toContain("Cruise Confirmations");
    expect(captured.data).not.toContain("fallback@example.invalid");

    const notification = await prisma.notification.findFirst({
      where: { bookingId, eventType: "BOOKING_AUTHORIZATION" },
      select: { status: true, mailAccountId: true },
    });

    expect(notification?.status).toBe(NotificationStatus.SENT);
    expect(notification?.mailAccountId).toBe(id);

    await prisma.notification.deleteMany({ where: { bookingId } });
    await prisma.mailAccount.updateMany({
      where: { id },
      data: { isActive: false },
    });
  });
});

describe("credentials", () => {
  it("round-trips a password through the connection check", async () => {
    // The sink advertises no AUTH, so nodemailer will not attempt it — what
    // this proves is that a stored, encrypted password is decrypted and the
    // adapter built without throwing, which is the failure mode that would
    // otherwise surface as a dead mailbox.
    const id = await makeAccount("Credentialed", "creds@example.invalid", {
      username: "creds@example.invalid",
      password: "a-password-with-\"quotes\"-and-ünïcode",
    });

    const stored = await prisma.mailAccount.findUnique({
      where: { id },
      select: { passwordCipher: true },
    });

    // Never the password itself, under any encoding of it.
    expect(stored?.passwordCipher).toBeTruthy();
    expect(stored?.passwordCipher).not.toContain("a-password");
    expect(stored?.passwordCipher?.startsWith("v1.")).toBe(true);

    expect(await verifyMailAccount(id)).toEqual({ ok: true });

    const after = await prisma.mailAccount.findUnique({
      where: { id },
      select: { verifiedAt: true, lastError: true },
    });

    expect(after?.verifiedAt).not.toBeNull();
    expect(after?.lastError).toBeNull();
  });

  it("keeps the stored password when an edit leaves it unset", async () => {
    const id = await makeAccount("Kept", "kept@example.invalid", {
      username: "kept@example.invalid",
      password: "original-secret",
    });

    const before = await prisma.mailAccount.findUnique({
      where: { id },
      select: { passwordCipher: true },
    });

    await updateMailAccount(
      id,
      {
        label: `Kept renamed ${SUFFIX}`,
        fromEmail: "kept@example.invalid",
        host: "127.0.0.1",
        port,
        secure: false,
        isActive: true,
        username: "kept@example.invalid",
        // Undefined, which is what the form posts when the operator did not
        // retype it. Wiping it here would silently break a working mailbox.
      },
      actorId,
    );

    const after = await prisma.mailAccount.findUnique({
      where: { id },
      select: { passwordCipher: true, label: true },
    });

    expect(after?.passwordCipher).toBe(before?.passwordCipher);
    expect(after?.label).toContain("renamed");
  });

  it("records why a connection failed instead of leaving it verified", async () => {
    const id = await makeAccount("Broken", "broken@example.invalid");

    // Port 1: nothing listens, so the connection is refused.
    await prisma.mailAccount.update({ where: { id }, data: { port: 1 } });
    resetMailAccountCache();

    const outcome = await verifyMailAccount(id);
    expect(outcome.ok).toBe(false);

    const row = await prisma.mailAccount.findUnique({
      where: { id },
      select: { verifiedAt: true, lastError: true },
    });

    expect(row?.verifiedAt).toBeNull();
    expect(row?.lastError).toBeTruthy();
  });
});

describe("deleting an account", () => {
  it("keeps the delivery history and drops it from the defaults", async () => {
    const id = await makeAccount("Doomed", "doomed@example.invalid");
    const bookingId = await makeBooking();

    await sendAuthorizationEmail({
      bookingId,
      actorId,
      origin: "https://crm.example.invalid",
      mailAccountId: id,
    });

    await savePurposeDefaults({ authorization: id }, actorId);

    const { deleteMailAccount } = await import(
      "@/server/services/mail-account-service"
    );
    await deleteMailAccount(id, actorId);

    const notification = await prisma.notification.findFirst({
      where: { bookingId, eventType: "BOOKING_AUTHORIZATION" },
      select: { status: true, mailAccountId: true },
    });

    // The row survives; only the link to the deleted account is cleared.
    expect(notification?.status).toBe(NotificationStatus.SENT);
    expect(notification?.mailAccountId).toBeNull();

    const defaults = await prisma.businessSetting.findUnique({
      where: { key: MAIL_DEFAULTS_SETTING_KEY },
      select: { value: true },
    });

    expect(defaults?.value).not.toMatchObject({ authorization: id });

    await prisma.notification.deleteMany({ where: { bookingId } });
  });
});
