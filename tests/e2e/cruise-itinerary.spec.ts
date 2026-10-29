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
 * The cruise form takes an itinerary the same two ways the flight form does.
 *
 * The schema, the service and the `CruiseDetail` columns already carried
 * `reservationText` and `itineraryHtml`; only the form had no way to fill
 * them, leaving a two-line "Itinerary" box where the flight form offers a
 * paste area and a rich-text editor.
 */

let operations: TestUser;
let customer: TestCustomer;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "cruise-itin-ops");
  customer = await createTestCustomer();
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("the cruise form offers a reservation paste area and an editor", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/cruise");

  await expect(page.locator('textarea[name="reservationText"]')).toBeVisible();
  await expect(page.getByText("OR", { exact: true })).toBeVisible();

  // The editor's own document is contenteditable rather than a control; the
  // form submits it through a hidden input of the same name.
  await expect(page.locator('[contenteditable="true"]')).toBeVisible();
  await expect(page.locator('input[name="itineraryHtml"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Decode reservation using API" }),
  ).toBeVisible();

  // The old one-line field is still there, under its own name.
  await expect(page.locator('textarea[name="itinerary"]')).toBeVisible();
});

test("the decode button admits there is no cruise-line integration", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/cruise");

  await page
    .getByRole("button", { name: "Decode reservation using API" })
    .click();

  await expect(
    page.getByText("No cruise-line integration is configured."),
  ).toBeVisible();
});

test("a cruise booking saves both the pasted reservation and the itinerary", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/cruise");

  await fillCardDetails(page);
  await page.locator('select[name="customerId"]').selectOption(customer.id);
  await page.locator('input[name="cruiseLine"]').fill("Royal Caribbean");
  await page.locator('input[name="guests.0.firstName"]').fill("Perpetua");
  await page.locator('input[name="guests.0.lastName"]').fill("E2EItinerary");

  await page
    .locator('textarea[name="reservationText"]')
    .fill("RCCL CONF 8842199 / WONDER OF THE SEAS / 7NT");

  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Day 1 Galveston, Day 2 at sea, Day 3 Cozumel");

  await page.locator('textarea[name="itinerary"]').fill("Galveston, Cozumel");

  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);

  // The one-line summary is what the Sailing panel prints back.
  await expect(page.getByText("Galveston, Cozumel")).toBeVisible();
});
