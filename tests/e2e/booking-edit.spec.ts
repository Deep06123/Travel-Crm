import { expect, test } from "@playwright/test";
import mariadb from "mariadb";

import { mysqlPoolConfig } from "../../src/lib/db/mysql-url";
import {
  cleanupFixtures,
  createTestBooking,
  createTestCustomer,
  createTestUser,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Correcting a booking after it was created.
 *
 * Two values were reachable only on the create form, and both led somewhere
 * with no way out:
 *
 *   * `grossMcoMinor` — the MCO panel reports "this booking has no gross MCO
 *     amount, so there is nothing to submit" and offered no way to supply one.
 *   * `airlineConfirmation` — the ticketing gate refuses until it is set, but
 *     the airline sends it back *after* the booking is taken, so it was rarely
 *     available at the only moment it could be entered. The panel asked the
 *     operator to record a reference and gave them nowhere to record it.
 *
 * Both dead ends are reproduced here before the fix is exercised, so these
 * fail loudly if the forms are removed.
 */

let admin: TestUser;

test.beforeEach(async () => {
  admin = await createTestUser("SUPER_ADMIN", "edit-admin");
});

test.afterEach(async () => {
  await cleanupFixtures();
});

async function openBooking(
  page: import("@playwright/test").Page,
  overrides: Parameters<typeof createTestBooking>[2] = {},
) {
  const customer = await createTestCustomer();
  const booking = await createTestBooking(customer.id, admin.id, overrides);
  await signIn(page, admin);
  await page.goto(`/admin/bookings/${booking.id}`);
  return booking;
}

/** Audit summaries written against a booking, newest first. */
async function auditFor(bookingId: string): Promise<string[]> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required to run these tests.");

  const pool = mariadb.createPool(mysqlPoolConfig(url, { connectionLimit: 1 }));
  try {
    const rows = (await pool.query(
      "SELECT `summary`, `changes` FROM `AuditLog` WHERE `entityId` = ? ORDER BY `createdAt` DESC",
      [bookingId],
    )) as { summary: string; changes: unknown }[];
    return rows.map((row) => `${row.summary} ${JSON.stringify(row.changes)}`);
  } finally {
    await pool.end();
  }
}

/** The fixture opens bookings with the MCO not applicable; this puts one in play. */
async function setMcoPending(bookingId: string): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required to run these tests.");

  const pool = mariadb.createPool(mysqlPoolConfig(url, { connectionLimit: 1 }));
  try {
    await pool.query(
      "UPDATE `Booking` SET `mcoStatus` = 'PENDING' WHERE `id` = ?",
      [bookingId],
    );
  } finally {
    await pool.end();
  }
}

test("an MCO amount can be added to an existing booking", async ({ page }) => {
  const customer = await createTestCustomer();
  // `totalMinor: 0` also zeroes the fixture's gross MCO, which is what the
  // MCO panel complains about.
  const booking = await createTestBooking(customer.id, admin.id, {
    totalMinor: 0,
  });
  await setMcoPending(booking.id);

  await signIn(page, admin);
  await page.goto(`/admin/bookings/${booking.id}`);

  const mco = page.locator("section", {
    has: page.getByRole("heading", { name: "MCO", exact: true }),
  });

  // The dead end: naming a supplier and submitting is refused, because the
  // booking carries no gross MCO and there was no way to give it one.
  const submitMco = async () => {
    await mco.locator('select[name="mcoSupplierId"]').selectOption({
      label: "Skyhyflights",
    });
    await mco.locator('select[name="toStatus"]').selectOption("SUBMITTED");
    await mco.getByRole("button", { name: "Update MCO" }).click();
  };

  await submitMco();
  await expect(mco).toContainText("no gross MCO amount");

  await page.locator('input[name="grossMco"]').fill("250.00");
  await page.locator('input[name="netMco"]').fill("240.00");
  await page.getByRole("button", { name: "Save amounts" }).click();

  await expect(page.getByText("Amounts updated.")).toBeVisible();

  // Read back from the rendered detail rows, not from the form inputs.
  const accounting = page.locator("section", {
    has: page.getByRole("heading", { name: "Accounting", exact: true }),
  });
  await expect(accounting).toContainText("$250.00");
  await expect(accounting).toContainText("$240.00");

  // And the submission that was impossible now goes through.
  await submitMco();
  await expect(mco).not.toContainText("no gross MCO amount");
  await expect(mco).toContainText("Submitted");

  // Moving booking value has to be attributable, so the entry carries the
  // before and after rather than just saying something changed.
  const entries = await auditFor(booking.id);
  const financials = entries.find((entry) => entry.includes("financials"));
  expect(financials).toBeDefined();
  expect(financials).toContain("25000 USD");
  expect(financials).toContain("0 USD");
});

test("split charges can be corrected after the booking was created", async ({
  page,
}) => {
  await openBooking(page);

  const accounting = page.locator("section", {
    has: page.getByRole("heading", { name: "Accounting", exact: true }),
  });

  await accounting
    .locator('select[name="splitCharges"]')
    .selectOption("true");

  // Turning the flag on is not on its own a division: the form refuses a split
  // total with nothing to split it into, which is the rule being respected
  // here rather than worked around. The two amounts are the booking's own
  // total, because a division that does not add up is refused as well.
  const splits = accounting.getByRole("group", {
    name: "How the total is split",
  });

  await splits.getByLabel("Title").first().fill("Deposit");
  await splits.getByLabel("Amount").first().fill("500.00");
  await splits.getByLabel("Title").nth(1).fill("Balance");
  await splits.getByLabel("Amount").nth(1).fill("529.97");

  await page.getByRole("button", { name: "Save amounts" }).click();

  await expect(page.getByText("Amounts updated.")).toBeVisible();
  // Read back from the detail row rather than the control that set it.
  await expect(
    accounting.locator("dt", { hasText: "Split charges" }).locator("+ dd"),
  ).toHaveText("Yes");
});

test("a bad amount is refused against the booking's currency", async ({
  page,
}) => {
  await openBooking(page);

  await page.locator('input[name="grossMco"]').fill("not-money");
  await page.getByRole("button", { name: "Save amounts" }).click();

  await expect(page.getByText("Amounts updated.")).toHaveCount(0);
  const accounting = page.locator("section", {
    has: page.getByRole("heading", { name: "Accounting", exact: true }),
  });
  await expect(accounting).toContainText("Enter");
});

test("the airline confirmation can be recorded, unblocking the ticket", async ({
  page,
}) => {
  // No confirmation and nothing owed, so the confirmation is the only thing
  // standing between this booking and an issued ticket.
  await openBooking(page, { status: "CONFIRMED", totalMinor: 0 });

  const ticketing = page.locator("section", {
    has: page.getByRole("heading", { name: "Ticketing", exact: true }),
  });

  // The dead end: issuing is refused and the message names a reference the
  // page could not set.
  await ticketing.getByRole("button", { name: "Issue ticket" }).click();
  await expect(ticketing).toContainText(
    "Record the airline or supplier confirmation reference",
  );

  await page.locator('input[name="airlineConfirmation"]').fill("AC-55512");
  await page.locator('input[name="ticketingReference"]').first().fill("SUP-77");
  await page.getByRole("button", { name: "Save references" }).click();

  await expect(page.getByText("References updated.")).toBeVisible();
  await expect(ticketing).toContainText("AC-55512");

  // The confirmation gate is satisfied now. Issuing still needs a ticket
  // number per passenger, which is a separate rule and stays enforced.
  await ticketing.getByRole("button", { name: "Issue ticket" }).click();
  await expect(ticketing).toContainText(
    "Enter a ticket number for at least one passenger.",
  );
  await expect(ticketing).not.toContainText(
    "Record the airline or supplier confirmation reference",
  );

  await ticketing.locator('input[name^="ticketNumber"]').first().fill("176-9001");
  await ticketing.getByRole("button", { name: "Issue ticket" }).click();

  // The control hides itself once issued, taking its banner with it, so
  // the status row is what proves it went through.
  await expect(ticketing).toContainText("Issued");
  await expect(
    ticketing.getByRole("button", { name: "Issue ticket" }),
  ).toHaveCount(0);
});

test("a read-only role is offered neither form", async ({ page }) => {
  const customer = await createTestCustomer();
  const booking = await createTestBooking(customer.id, admin.id);

  const viewer = await createTestUser("READ_ONLY", "edit-viewer");
  await signIn(page, viewer);
  await page.goto(`/admin/bookings/${booking.id}`);

  await expect(page.getByRole("button", { name: "Save amounts" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save references" }),
  ).toHaveCount(0);
});
