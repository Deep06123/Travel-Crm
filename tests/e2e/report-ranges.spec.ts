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
 * Date-range filtering on the reports and the bookings list.
 *
 * `bookedAt` is an instant; a range is a pair of calendar days the operator
 * picked. Reconciling the two went wrong twice, in both cases only when the
 * business timezone is behind UTC — which `America/New_York` is, so both were
 * live. The reports dropped the whole of the chosen end day; the bookings list
 * dropped its last four hours. Neither was visible to a test that let the
 * range default, because a booking made at midday survives every one of the
 * broken boundaries. Only an evening one shows it.
 *
 * The timezone arithmetic itself is covered independently of any zone in
 * `tests/unit/report-range.test.ts`. What these add is the wiring: that the
 * pages actually use it, end to end, in the configured deployment.
 *
 * `bookedAt` literals below are written as UTC, which is how the column is
 * stored and read back.
 */

const BUSINESS_TZ = process.env["BUSINESS_TIMEZONE"] ?? "UTC";

// 23:30 on 20 October in New York. Inside the 20th where the business is,
// outside it in UTC — which is the whole point.
const LATE_ON_THE_20TH = "2026-10-21 03:30:00";
// 01:00 on 21 October in New York. Genuinely the following day.
const EARLY_ON_THE_21ST = "2026-10-21 05:00:00";

test.skip(
  BUSINESS_TZ !== "America/New_York",
  `These pin instants that straddle midnight in America/New_York; ` +
    `BUSINESS_TIMEZONE is ${BUSINESS_TZ}. The zone-independent cover is in ` +
    `tests/unit/report-range.test.ts.`,
);

let admin: TestUser;

/** The fixture stamps `bookedAt` as now, so a precise one is set directly. */
async function pinBookedAt(bookingId: string, utcLiteral: string): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required to run these tests.");

  const pool = mariadb.createPool(mysqlPoolConfig(url, { connectionLimit: 1 }));
  try {
    await pool.query("UPDATE `Booking` SET `bookedAt` = ? WHERE `id` = ?", [
      utcLiteral,
      bookingId,
    ]);
  } finally {
    await pool.end();
  }
}

async function bookingPinnedTo(utcLiteral: string) {
  const customer = await createTestCustomer();
  const booking = await createTestBooking(customer.id, admin.id, {
    status: "CONFIRMED",
  });
  await pinBookedAt(booking.id, utcLiteral);
  return booking;
}

// Per test, not per file: one case asserts that a period is *empty*, which a
// booking left behind by an earlier case would quietly falsify. The suite runs
// with `workers: 1`, so clearing between tests cannot disturb another spec.
test.beforeEach(async () => {
  admin = await createTestUser("SUPER_ADMIN", "range-admin");
});

test.afterEach(async () => {
  await cleanupFixtures();
});

test("a report range includes the whole of its end day", async ({ page }) => {
  await bookingPinnedTo(LATE_ON_THE_20TH);

  await signIn(page, admin);
  await page.goto("/admin/reports/bookings?from=2026-10-19&to=2026-10-20");

  const main = page.locator("main");
  await expect(main).toContainText("Confirmed");
  // The heading must echo the days asked for, not the day before.
  await expect(main).toContainText("19 Oct 2026 – 20 Oct 2026");
});

test("a report range excludes the day after its end day", async ({ page }) => {
  // Without this the fix could widen every range by a day and still pass.
  await bookingPinnedTo(EARLY_ON_THE_21ST);

  await signIn(page, admin);
  await page.goto("/admin/reports/bookings?from=2026-10-19&to=2026-10-20");

  await expect(page.locator("main")).toContainText(
    "No bookings in the selected period.",
  );
});

test("the bookings list filter covers the evening of its end day", async ({
  page,
}) => {
  const booking = await bookingPinnedTo(LATE_ON_THE_20TH);

  await signIn(page, admin);
  await page.goto("/admin/bookings?from=2026-10-20&to=2026-10-20");

  await expect(page.locator("main")).toContainText(booking.bookingNumber);
});

test("the trend plots a booking on its business day", async ({ page }) => {
  await bookingPinnedTo(LATE_ON_THE_20TH);

  await signIn(page, admin);
  await page.goto("/admin/reports/bookings?from=2026-10-19&to=2026-10-20");

  // The chart used to group on the stored UTC day, so this booking appeared
  // as a bar on 10-21 inside a report headed "19 Oct – 20 Oct".
  const trend = page.getByRole("heading", { name: "Booking trend" });
  await expect(trend).toBeVisible();

  const chart = page.locator("section", { has: trend });
  await expect(chart).toContainText("10-20");
  await expect(chart).not.toContainText("10-21");
});

test("a backwards range is read the way round it was meant", async ({
  page,
}) => {
  await bookingPinnedTo(LATE_ON_THE_20TH);

  await signIn(page, admin);
  // From after to. Reported nothing at all before, which reads as "no
  // activity" rather than "your dates are the wrong way round".
  await page.goto("/admin/reports/bookings?from=2026-10-21&to=2026-10-19");

  await expect(page.locator("main")).toContainText("Confirmed");
});
