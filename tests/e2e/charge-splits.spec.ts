import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  createTestUser,
  fillCardDetails,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Splitting a total across more than one card.
 *
 * "Split charges" used to be a Yes/No flag with nothing behind it: the
 * division — which card took how much — lived in the notes, if it was written
 * down at all. These tests cover the two things that make the rows worth
 * having: that they are stored and shown, and that they are checked against
 * the total fare before the booking is accepted.
 */

let operations: TestUser;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "splits-ops");
});

test.afterAll(async () => {
  await cleanupFixtures();
});

/** The accounting panel starts collapsed on the create form. */
async function openCruiseAccounting(page: import("@playwright/test").Page) {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/cruise");
  await page
    .getByRole("button", { name: "Expand Accounting information" })
    .click();
}

/** The minimum a cruise booking needs before it will be accepted. */
async function fillRequiredCruiseFields(
  page: import("@playwright/test").Page,
  lastName: string,
) {
  await fillCardDetails(page);
  await page.locator('input[name="cruiseLine"]').fill("Royal Caribbean");
  await page.locator('input[name="guests.0.firstName"]').fill("Perpetua");
  await page.locator('input[name="guests.0.lastName"]').fill(lastName);
}

test("the split rows appear only once the total is marked as split", async ({
  page,
}) => {
  await openCruiseAccounting(page);

  await expect(page.locator('input[name="splits.0.amount"]')).toHaveCount(0);

  await page.locator('select[name="splitCharges"]').selectOption("true");

  // Two rows to begin with, because one charge is not a split.
  await expect(page.locator('input[name="splits.0.amount"]')).toBeVisible();
  await expect(page.locator('input[name="splits.1.amount"]')).toBeVisible();

  await page.getByRole("button", { name: "Add split" }).click();
  await expect(page.locator('input[name="splits.2.amount"]')).toBeVisible();
});

test("splits that do not add up to the total fare are refused", async ({
  page,
}) => {
  await openCruiseAccounting(page);
  await fillRequiredCruiseFields(page, "E2ESplitBad");

  await page.locator('input[name="total"]').fill("1800.00");
  await page.locator('select[name="splitCharges"]').selectOption("true");

  // 900 + 800 is 1,700, not the 1,800 being charged.
  await page.locator('input[name="splits.0.title"]').fill("Deposit");
  await page.locator('input[name="splits.0.amount"]').fill("900.00");
  await page.locator('input[name="splits.1.title"]').fill("Balance");
  await page.locator('input[name="splits.1.amount"]').fill("800.00");

  // The running total says so before anything is submitted.
  await expect(page.getByText("Splits total $1,700.00 of $1,800.00")).toBeVisible();

  await page.getByRole("button", { name: "Create booking" }).click();

  await expect(page).toHaveURL(/\/admin\/bookings\/new\/cruise$/);
  // Named twice over — once beside the rows, once in the guide at the top of
  // the form — so the alert beside the rows is the one asserted on.
  await expect(
    page
      .getByRole("group", { name: "How the total is split" })
      .getByRole("alert"),
  ).toContainText("The splits add up to $1,700.00");
});

test("a split booking stores the division and shows it back", async ({
  page,
}) => {
  await openCruiseAccounting(page);
  await fillRequiredCruiseFields(page, "E2ESplitGood");

  await page.locator('input[name="total"]').fill("1800.00");
  await page.locator('select[name="splitCharges"]').selectOption("true");

  await page.locator('input[name="splits.0.title"]').fill("Deposit");
  await page.locator('input[name="splits.0.amount"]').fill("900.00");
  await page.locator('input[name="splits.1.title"]').fill("Balance");
  await page.locator('input[name="splits.1.amount"]').fill("900.00");

  await expect(page.getByText("Splits total $1,800.00 of $1,800.00 ✓")).toBeVisible();

  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);

  const accounting = page.locator("section", {
    has: page.getByRole("heading", { name: "Accounting", exact: true }),
  });

  // By role, not by text: the panel carries this wording twice — as the
  // heading over the stored division, and again as the legend of the edit
  // form below it — and a bare text match resolves to both.
  await expect(
    accounting.getByRole("heading", { name: "How the total is split" }),
  ).toBeVisible();
  // As cells, not as loose text: "Balance" also appears in the panel's note
  // about the outstanding balance, and a bare text match resolves to both.
  await expect(
    accounting.getByRole("cell", { name: "Deposit", exact: true }),
  ).toBeVisible();
  await expect(
    accounting.getByRole("cell", { name: "Balance", exact: true }),
  ).toBeVisible();
  await expect(
    accounting.getByText("matching the gross booking value"),
  ).toBeVisible();
});
