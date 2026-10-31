import { expect, test } from "@playwright/test";

import {
  cleanupFixtures,
  createTestUser,
  fillCardDetails,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * The cruise form takes its itinerary one way: the editor.
 *
 * Unlike the flight form it offers no paste area and no decode button — a
 * cruise confirmation was never decoded, so the raw-text half of that pair
 * only ever stood for a feature that does not exist. The one-line "Ports of
 * call" summary is gone with it; `itineraryHtml` is the itinerary of record.
 */

let operations: TestUser;

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "cruise-itin-ops");
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("the cruise form offers the editor and nothing to paste into", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/cruise");

  // The editor's own document is contenteditable rather than a control; the
  // form submits it through a hidden input of the same name.
  await expect(page.locator('[contenteditable="true"]')).toBeVisible();
  await expect(page.locator('input[name="itineraryHtml"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();

  await expect(page.locator('textarea[name="reservationText"]')).toHaveCount(0);
  await expect(page.locator('textarea[name="itinerary"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Decode reservation using API" }),
  ).toHaveCount(0);
});

test("a cruise booking saves the itinerary that was typed", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/cruise");

  await fillCardDetails(page);
  // No customer picker on the cruise form: the first guest becomes one.
  await page.locator('input[name="cruiseLine"]').fill("Royal Caribbean");
  await page.locator('input[name="guests.0.firstName"]').fill("Perpetua");
  await page.locator('input[name="guests.0.lastName"]').fill("E2EItinerary");

  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type("Day 1 Galveston, Day 2 at sea, Day 3 Cozumel");

  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);

  await expect(
    page.getByRole("cell", { name: "Perpetua E2EItinerary" }),
  ).toBeVisible();

  // And the Sailing panel prints it back, rather than storing it unseen.
  await expect(
    page.getByText("Day 1 Galveston, Day 2 at sea, Day 3 Cozumel"),
  ).toBeVisible();
});
