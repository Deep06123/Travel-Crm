import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  createTestCustomer,
  createTestUser,
  fillCardDetails,
  signIn,
  type TestCustomer,
  type TestUser,
} from "./fixtures";

/**
 * Travel dates survive the trip to the database and back.
 *
 * A date-only field is stored as midnight UTC, and this application runs with
 * BUSINESS_TIMEZONE=America/New_York. Rendering that instant in New York lands
 * at 19:00 the previous evening, so every travel date displayed a day early —
 * a sailing entered as the ninth of November was shown, mailed and ticketed as
 * the eighth.
 *
 * This has to run against the real server to mean anything: the unit tests
 * have no business timezone configured, so they cannot see the shift. Here the
 * date goes in through the form, through the action, into MySQL and back out
 * through the page, which is the whole path the bug lived on.
 */

let operations: TestUser;
let customer: TestCustomer;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "caldate-ops");
  customer = await createTestCustomer();
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("a cruise keeps the sail and return dates it was given", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/cruise");

  // Every booking needs a card: the form will not submit without one.
  await fillCardDetails(page);

  await page.locator('input[name="cruiseLine"]').fill("Royal Caribbean");
  await page.locator('input[name="guests.0.firstName"]').fill("Perpetua");
  await page.locator('input[name="guests.0.lastName"]').fill("E2ECalendar");

  await page.locator('input[name="sailDate"]').fill("2027-11-09");
  await page.locator('input[name="returnDate"]').fill("2027-11-16");

  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);

  // The ninth, not the eighth.
  await expect(page.getByText("09 Nov 2027")).toBeVisible();
  await expect(page.getByText("16 Nov 2027")).toBeVisible();
  await expect(page.getByText("08 Nov 2027")).toHaveCount(0);
  await expect(page.getByText("15 Nov 2027")).toHaveCount(0);
});

test("a flight keeps its travelling date and a date of birth", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/flight");

  // Every booking needs a card: the form will not submit without one.
  await fillCardDetails(page);

  await page.locator('select[name="customerId"]').selectOption(customer.id);
  await page.locator('input[name="passengers.0.firstName"]').fill("Harriet");
  await page.locator('input[name="passengers.0.lastName"]').fill("E2ECalendar");

  // The first of a month is the unforgiving case: a shift backwards crosses
  // into the previous month, and in January into the previous year.
  await page.locator('input[name="departureDate"]').fill("2027-03-01");
  await page.locator('input[name="passengers.0.dateOfBirth"]').fill("1988-07-04");

  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);

  await expect(page.getByText("01 Mar 2027")).toBeVisible();
  await expect(page.getByText("28 Feb 2027")).toHaveCount(0);

  await expect(page.getByText("04 Jul 1988")).toBeVisible();
  await expect(page.getByText("03 Jul 1988")).toHaveCount(0);
});
