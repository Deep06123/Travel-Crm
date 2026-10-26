import { randomBytes } from "node:crypto";

import type { Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import mariadb from "mariadb";

import { mysqlPoolConfig } from "../../src/lib/db/mysql-url";

/**
 * Fixture helpers for the browser tests.
 *
 * These talk to MySQL through the mariadb driver directly, with plain SQL,
 * rather than through Prisma. Playwright transpiles specs as CommonJS while the
 * generated Prisma client is ESM and uses `import.meta`, so it cannot be
 * imported here. Shelling out to a tsx subprocess per call worked but opened a
 * fresh connection pool each time, which exhausted the development server's
 * limit and made the suite both slow and flaky.
 *
 * One shared pool for the whole run keeps fixtures fast and stable. The browser
 * still drives the real UI — only the arranging of preconditions is direct.
 */

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL is required to run end-to-end tests.");
}

// A small pool: the Next.js dev server already holds connections, and a
// development MySQL has a modest limit.
const pool = mariadb.createPool(
  mysqlPoolConfig(connectionString, { connectionLimit: 2 }),
);

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
  // The driver returns the row array itself for a SELECT, with result metadata
  // hung off it as a non-enumerable property.
  const rows = (await pool.query(sql, params)) as unknown;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** `?, ?, ?` for an IN list, which MySQL cannot take as a single array param. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
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

  // NOW(3) rather than NOW(): Prisma maps DateTime to DATETIME(3) on MySQL, and
  // the second-precision default would silently drop the milliseconds that
  // ordering assertions depend on.
  await query(
    `INSERT INTO \`AdminUser\`
       (\`id\`, \`email\`, \`name\`, \`passwordHash\`, \`role\`, \`status\`,
        \`mustChangePassword\`, \`failedLoginAttempts\`, \`passwordChangedAt\`,
        \`createdAt\`, \`updatedAt\`)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', false, 0, NOW(3), NOW(3), NOW(3))`,
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
    `INSERT INTO \`Customer\`
       (\`id\`, \`reference\`, \`firstName\`, \`lastName\`, \`email\`, \`status\`,
        \`createdAt\`, \`updatedAt\`)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', NOW(3), NOW(3))`,
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
  const supplierCost = Math.round(totalMinor * 0.9);

  // Every placeholder is supplied once: MySQL binds `?` strictly by position,
  // so the values Postgres let us reuse as `$5` and `$8` are repeated here.
  await query(
    `INSERT INTO \`Booking\`
       (\`id\`, \`bookingNumber\`, \`product\`, \`status\`, \`priority\`,
        \`customerId\`, \`createdById\`, \`assignedAgentId\`, \`currency\`,
        \`baseFareMinor\`, \`taxesFeesMinor\`, \`totalMinor\`,
        \`supplierCostMinor\`, \`grossMcoMinor\`, \`netMcoMinor\`,
        \`ticketStatus\`, \`airlineConfirmation\`, \`mcoStatus\`,
        \`splitCharges\`, \`bookedAt\`, \`createdAt\`, \`updatedAt\`)
     VALUES (?, ?, 'FLIGHT', ?, 'NORMAL', ?, ?, ?, 'USD',
             ?, ?, ?, ?, ?, ?, 'PENDING', ?, 'NOT_APPLICABLE', false,
             NOW(3), NOW(3), NOW(3))`,
    [
      id,
      bookingNumber,
      status,
      customerId,
      createdById,
      createdById,
      baseFare,
      totalMinor - baseFare,
      totalMinor,
      supplierCost,
      totalMinor,
      supplierCost,
      airlineConfirmation,
    ],
  );

  await query(
    `INSERT INTO \`FlightDetail\`
       (\`id\`, \`bookingId\`, \`airline\`, \`origin\`, \`destination\`,
        \`pnrLocator\`, \`isRoundTrip\`, \`createdAt\`, \`updatedAt\`)
     VALUES (?, ?, 'Delta', 'JFK', 'LHR', ?, false, NOW(3), NOW(3))`,
    [newId(), id, `PNR${suffix}`],
  );

  if (withPassenger) {
    await query(
      `INSERT INTO \`Passenger\`
         (\`id\`, \`bookingId\`, \`sequence\`, \`firstName\`, \`lastName\`,
          \`type\`, \`passportNumber\`, \`dateOfBirth\`, \`createdAt\`, \`updatedAt\`)
       VALUES (?, ?, 1, 'Evelyn', 'Testcase', 'ADULT', ?, ?, NOW(3), NOW(3))`,
      // Restricted detail, so a redaction test has something to look for.
      [newId(), id, `P${suffix}99887`, new Date("1984-02-29T00:00:00Z")],
    );
  }

  await query(
    `INSERT INTO \`BookingStatusHistory\`
       (\`id\`, \`bookingId\`, \`fromStatus\`, \`toStatus\`, \`reason\`,
        \`changedById\`, \`createdAt\`)
     VALUES (?, ?, NULL, ?, 'E2E fixture', ?, NOW(3))`,
    [newId(), id, status, createdById],
  );

  return { id, bookingNumber };
}

export async function revokeSessions(userId: string): Promise<void> {
  await query(
    `UPDATE \`AdminSession\` SET \`revokedAt\` = NOW(3)
     WHERE \`adminUserId\` = ? AND \`revokedAt\` IS NULL`,
    [userId],
  );
}

export async function setUserStatus(
  userId: string,
  status: string,
): Promise<void> {
  await query(`UPDATE \`AdminUser\` SET \`status\` = ? WHERE \`id\` = ?`, [
    status,
    userId,
  ]);
}

export async function getBookingStatus(bookingId: string): Promise<string | null> {
  const rows = await query<{ status: string }>(
    `SELECT \`status\` FROM \`Booking\` WHERE \`id\` = ?`,
    [bookingId],
  );

  return rows[0]?.status ?? null;
}

export async function countRefunds(bookingId: string): Promise<number> {
  const rows = await query<{ count: bigint }>(
    `SELECT COUNT(*) AS count FROM \`Refund\` WHERE \`bookingId\` = ?`,
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
      `SELECT \`id\` FROM \`AdminUser\` WHERE \`email\` LIKE ?`,
      [`%${E2E_TAG}%`],
    )
  ).map((row) => row.id);

  const customerIds = (
    await query<{ id: string }>(
      `SELECT \`id\` FROM \`Customer\` WHERE \`reference\` LIKE ? OR \`email\` LIKE ?`,
      [`%${E2E_TAG}%`, `%${E2E_TAG}%`],
    )
  ).map((row) => row.id);

  // Bookings reached either by their fixture number or through a fixture
  // customer. The second arm is only expressible when there are customers to
  // name: MySQL rejects an empty `IN ()`.
  const bookingIds = (
    await query<{ id: string }>(
      customerIds.length > 0
        ? `SELECT \`id\` FROM \`Booking\`
           WHERE \`bookingNumber\` LIKE 'MVE2E%'
              OR \`customerId\` IN (${placeholders(customerIds.length)})`
        : `SELECT \`id\` FROM \`Booking\` WHERE \`bookingNumber\` LIKE 'MVE2E%'`,
      customerIds,
    )
  ).map((row) => row.id);

  /**
   * Runs a statement whose only variable part is one IN list.
   *
   * Skipped outright when the list is empty — `IN ()` is a syntax error in
   * MySQL, where Postgres accepted `= ANY('{}')` and matched nothing.
   */
  const inList = async (sql: (list: string) => string, ids: string[]) => {
    if (ids.length === 0) return;
    await query(sql(placeholders(ids.length)), ids);
  };

  /** Two IN lists in one statement, with the same empty-list guard. */
  const inLists = async (
    sql: (first: string, second: string) => string,
    first: string[],
    second: string[],
  ) => {
    if (first.length === 0 && second.length === 0) return;
    // A placeholder list must be non-empty, so an absent side is written as the
    // literal NULL — valid in an IN list and matched by no id. It consumes no
    // placeholder, which is why only the non-empty sides contribute params.
    const render = (ids: string[]) =>
      ids.length > 0 ? placeholders(ids.length) : "NULL";

    await query(sql(render(first), render(second)), [...first, ...second]);
  };

  await inList(
    (l) =>
      `DELETE FROM \`ChargebackEvidence\` WHERE \`chargebackId\` IN (SELECT \`id\` FROM \`Chargeback\` WHERE \`bookingId\` IN (${l}))`,
    bookingIds,
  );
  await inList((l) => `DELETE FROM \`Chargeback\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inList((l) => `DELETE FROM \`Refund\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inList((l) => `DELETE FROM \`Payment\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inList(
    (l) => `UPDATE \`Document\` SET \`currentVersionId\` = NULL WHERE \`bookingId\` IN (${l})`,
    bookingIds,
  );
  await inList(
    (l) =>
      `DELETE FROM \`DocumentVersion\` WHERE \`documentId\` IN (SELECT \`id\` FROM \`Document\` WHERE \`bookingId\` IN (${l}))`,
    bookingIds,
  );
  await inLists(
    (b, c) =>
      `DELETE FROM \`Document\` WHERE \`bookingId\` IN (${b}) OR \`customerId\` IN (${c})`,
    bookingIds,
    customerIds,
  );
  await inList((l) => `DELETE FROM \`BookingFollowUp\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inList((l) => `DELETE FROM \`BookingComment\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inList(
    (l) => `DELETE FROM \`BookingStatusHistory\` WHERE \`bookingId\` IN (${l})`,
    bookingIds,
  );
  await inList((l) => `DELETE FROM \`Passenger\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inList((l) => `DELETE FROM \`FlightSegment\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inList((l) => `DELETE FROM \`FlightDetail\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inList((l) => `DELETE FROM \`CruiseDetail\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inList((l) => `DELETE FROM \`CallRecord\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inLists(
    (b, c) =>
      `DELETE FROM \`CustomerServiceCase\` WHERE \`bookingId\` IN (${b}) OR \`customerId\` IN (${c})`,
    bookingIds,
    customerIds,
  );
  await inList((l) => `DELETE FROM \`Message\` WHERE \`bookingId\` IN (${l})`, bookingIds);
  await inList((l) => `DELETE FROM \`Booking\` WHERE \`id\` IN (${l})`, bookingIds);
  await inList((l) => `DELETE FROM \`CustomerNote\` WHERE \`customerId\` IN (${l})`, customerIds);
  await inList((l) => `DELETE FROM \`Customer\` WHERE \`id\` IN (${l})`, customerIds);

  await inList((l) => `DELETE FROM \`MessageRecipient\` WHERE \`recipientId\` IN (${l})`, userIds);
  await inList((l) => `DELETE FROM \`Message\` WHERE \`senderId\` IN (${l})`, userIds);
  await inList((l) => `DELETE FROM \`AuditLog\` WHERE \`adminUserId\` IN (${l})`, userIds);
  await inList((l) => `DELETE FROM \`LoginEvent\` WHERE \`adminUserId\` IN (${l})`, userIds);
  await inList((l) => `DELETE FROM \`AdminSession\` WHERE \`adminUserId\` IN (${l})`, userIds);
  await inList((l) => `DELETE FROM \`Agent\` WHERE \`adminUserId\` IN (${l})`, userIds);
  await inList((l) => `DELETE FROM \`AdminUser\` WHERE \`id\` IN (${l})`, userIds);
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
