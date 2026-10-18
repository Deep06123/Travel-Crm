import { randomBytes } from "node:crypto";

import type { Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

/**
 * Fixture helpers for the browser tests.
 *
 * These talk to Postgres through `pg` directly, with plain SQL, rather than
 * through Prisma. Playwright transpiles specs as CommonJS while the generated
 * Prisma client is ESM and uses `import.meta`, so it cannot be imported here.
 * Shelling out to a tsx subprocess per call worked but opened a fresh
 * connection pool each time, which exhausted the development server's limit
 * and made the suite both slow and flaky.
 *
 * One shared pool for the whole run keeps fixtures fast and stable. The browser
 * still drives the real UI — only the arranging of preconditions is direct.
 */

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL is required to run end-to-end tests.");
}

// A small pool: the Next.js dev server already holds connections, and the
// bundled development Postgres has a modest limit.
const pool = new Pool({ connectionString, max: 2 });

/** Marks every fixture so teardown can find them regardless of test outcome. */
export const E2E_TAG = "e2e-fixture";

export const TEST_PASSWORD = "e2e-test-password-9271";

/** Prisma generates cuids in the client, so raw inserts supply their own id. */
function newId(): string {
  return `e2e${randomBytes(12).toString("hex")}`;
}

async function query<T = unknown>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
  role: string;
}

export async function createTestUser(
  role: string,
  slug: string,
): Promise<TestUser> {
  const id = newId();
  const email = `${E2E_TAG}-${slug}-${randomBytes(4).toString("hex")}@example.invalid`;
  const name = `E2E ${slug}`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  await query(
    `INSERT INTO "AdminUser"
       (id, email, name, "passwordHash", role, status, "mustChangePassword",
        "failedLoginAttempts", "passwordChangedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::"AdminRole", 'ACTIVE', false, 0, now(), now(), now())`,
    [id, email, name, passwordHash, role],
  );

  return { id, email, password: TEST_PASSWORD, name, role };
}

export interface TestCustomer {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
}

export async function createTestCustomer(): Promise<TestCustomer> {
  const id = newId();
  const suffix = randomBytes(4).toString("hex");
  const reference = `CUS-${E2E_TAG}-${suffix}`;
  const firstName = "Evelyn";
  const lastName = `Testcase-${suffix}`;

  await query(
    `INSERT INTO "Customer"
       (id, reference, "firstName", "lastName", email, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now(), now())`,
    [id, reference, firstName, lastName, `${E2E_TAG}-cust-${suffix}@example.invalid`],
  );

  return { id, reference, firstName, lastName };
}

export interface TestBooking {
  id: string;
  bookingNumber: string;
}

export async function createTestBooking(
  customerId: string,
  createdById: string,
  overrides: {
    totalMinor?: number;
    status?: "DRAFT" | "PENDING" | "CONFIRMED" | "TICKETED";
    airlineConfirmation?: string;
    withPassenger?: boolean;
  } = {},
): Promise<TestBooking> {
  const {
    totalMinor = 102_997,
    status = "PENDING",
    airlineConfirmation = null,
    withPassenger = true,
  } = overrides;

  const id = newId();
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  const bookingNumber = `MVE2E${suffix}`;
  const baseFare = Math.round(totalMinor * 0.82);

  await query(
    `INSERT INTO "Booking"
       (id, "bookingNumber", product, status, priority, "customerId", "createdById",
        "assignedAgentId", currency, "baseFareMinor", "taxesFeesMinor", "totalMinor",
        "supplierCostMinor", "grossMcoMinor", "netMcoMinor", "ticketStatus",
        "airlineConfirmation", "mcoStatus", "splitCharges", "bookedAt",
        "createdAt", "updatedAt")
     VALUES ($1, $2, 'FLIGHT', $3::"BookingStatus", 'NORMAL', $4, $5, $5, 'USD',
             $6, $7, $8, $9, $8, $9, 'PENDING', $10, 'NOT_APPLICABLE', false,
             now(), now(), now())`,
    [
      id,
      bookingNumber,
      status,
      customerId,
      createdById,
      baseFare,
      totalMinor - baseFare,
      totalMinor,
      Math.round(totalMinor * 0.9),
      airlineConfirmation,
    ],
  );

  await query(
    `INSERT INTO "FlightDetail"
       (id, "bookingId", airline, origin, destination, "pnrLocator", "isRoundTrip",
        "createdAt", "updatedAt")
     VALUES ($1, $2, 'Delta', 'JFK', 'LHR', $3, false, now(), now())`,
    [newId(), id, `PNR${suffix}`],
  );

  if (withPassenger) {
    await query(
      `INSERT INTO "Passenger"
         (id, "bookingId", sequence, "firstName", "lastName", type,
          "passportNumber", "dateOfBirth", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 'Evelyn', 'Testcase', 'ADULT', $3, $4, now(), now())`,
      // Restricted detail, so a redaction test has something to look for.
      [newId(), id, `P${suffix}99887`, new Date("1984-02-29T00:00:00Z")],
    );
  }

  await query(
    `INSERT INTO "BookingStatusHistory"
       (id, "bookingId", "fromStatus", "toStatus", reason, "changedById", "createdAt")
     VALUES ($1, $2, NULL, $3::"BookingStatus", 'E2E fixture', $4, now())`,
    [newId(), id, status, createdById],
  );

  return { id, bookingNumber };
}

export async function revokeSessions(userId: string): Promise<void> {
  await query(
    `UPDATE "AdminSession" SET "revokedAt" = now()
     WHERE "adminUserId" = $1 AND "revokedAt" IS NULL`,
    [userId],
  );
}

export async function setUserStatus(
  userId: string,
  status: string,
): Promise<void> {
  await query(
    `UPDATE "AdminUser" SET status = $2::"AdminUserStatus" WHERE id = $1`,
    [userId, status],
  );
}

export async function getBookingStatus(bookingId: string): Promise<string | null> {
  const rows = await query<{ status: string }>(
    `SELECT status FROM "Booking" WHERE id = $1`,
    [bookingId],
  );

  return rows[0]?.status ?? null;
}

export async function countRefunds(bookingId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*) AS count FROM "Refund" WHERE "bookingId" = $1`,
    [bookingId],
  );

  return Number(rows[0]?.count ?? 0);
}

/**
 * Removes every fixture this suite created.
 *
 * Ordered innermost-first because financial rows use onDelete: Restrict — a
 * booking deliberately cannot take its payment history down with it, so the
 * teardown has to respect the same constraint real code does.
 */
export async function cleanupFixtures(): Promise<void> {
  const userIds = (
    await query<{ id: string }>(
      `SELECT id FROM "AdminUser" WHERE email LIKE $1`,
      [`%${E2E_TAG}%`],
    )
  ).map((row) => row.id);

  const customerIds = (
    await query<{ id: string }>(
      `SELECT id FROM "Customer" WHERE reference LIKE $1 OR email LIKE $1`,
      [`%${E2E_TAG}%`],
    )
  ).map((row) => row.id);

  const bookingIds = (
    await query<{ id: string }>(
      `SELECT id FROM "Booking"
       WHERE "bookingNumber" LIKE 'MVE2E%'
          OR "customerId" = ANY($1::text[])`,
      [customerIds],
    )
  ).map((row) => row.id);

  const b = [bookingIds];
  const u = [userIds];
  const c = [customerIds];

  await query(`DELETE FROM "ChargebackEvidence" WHERE "chargebackId" IN (SELECT id FROM "Chargeback" WHERE "bookingId" = ANY($1::text[]))`, b);
  await query(`DELETE FROM "Chargeback" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "Refund" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "Payment" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`UPDATE "Document" SET "currentVersionId" = NULL WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "DocumentVersion" WHERE "documentId" IN (SELECT id FROM "Document" WHERE "bookingId" = ANY($1::text[]))`, b);
  await query(`DELETE FROM "Document" WHERE "bookingId" = ANY($1::text[]) OR "customerId" = ANY($2::text[])`, [bookingIds, customerIds]);
  await query(`DELETE FROM "BookingFollowUp" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "BookingComment" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "BookingStatusHistory" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "Passenger" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "FlightSegment" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "FlightDetail" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "CruiseDetail" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "CallRecord" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "CustomerServiceCase" WHERE "bookingId" = ANY($1::text[]) OR "customerId" = ANY($2::text[])`, [bookingIds, customerIds]);
  await query(`DELETE FROM "Message" WHERE "bookingId" = ANY($1::text[])`, b);
  await query(`DELETE FROM "Booking" WHERE id = ANY($1::text[])`, b);
  await query(`DELETE FROM "CustomerNote" WHERE "customerId" = ANY($1::text[])`, c);
  await query(`DELETE FROM "Customer" WHERE id = ANY($1::text[])`, c);

  await query(`DELETE FROM "MessageRecipient" WHERE "recipientId" = ANY($1::text[])`, u);
  await query(`DELETE FROM "Message" WHERE "senderId" = ANY($1::text[])`, u);
  await query(`DELETE FROM "AuditLog" WHERE "adminUserId" = ANY($1::text[])`, u);
  await query(`DELETE FROM "LoginEvent" WHERE "adminUserId" = ANY($1::text[])`, u);
  await query(`DELETE FROM "AdminSession" WHERE "adminUserId" = ANY($1::text[])`, u);
  await query(`DELETE FROM "Agent" WHERE "adminUserId" = ANY($1::text[])`, u);
  await query(`DELETE FROM "AdminUser" WHERE id = ANY($1::text[])`, u);
}

/** Closes the shared pool so the test process can exit. */
export async function closeFixtures(): Promise<void> {
  await pool.end();
}

/**
 * Signs in through the real form.
 *
 * Deliberately not a cookie shortcut — the sign-in path is itself under test,
 * so using it everywhere means a regression there fails every spec loudly.
 */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  // Clear any existing session first. The login page correctly redirects an
  // already-signed-in administrator to the dashboard, so switching users
  // mid-test would otherwise never see the form.
  await page.context().clearCookies();

  await page.goto("/admin/login");
  await page.getByLabel("Email or username").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin(?!\/login)/);
}
