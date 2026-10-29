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
 * The guide box shown when a booking is rejected.
 *
 * The booking forms run to roughly eighty fields across six panels, three of
 * which start collapsed, so a rejected submission could leave the operator
 * with no visible sign of what was wrong. These drive the real forms, because
 * the box reads the rendered DOM to work out what to say — a unit test cannot
 * tell whether it found the right panel.
 */

let operations: TestUser;
let customer: TestCustomer;

const GUIDE = '[aria-label="Fields that need attention"]';

test.beforeAll(async () => {
  operations = await createTestUser("OPERATIONS", "form-guide-ops");
  customer = await createTestCustomer();
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("it names every rejected field, with the panel it lives in", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/flight");

  // Every booking needs a card: the form will not submit without one.
  await fillCardDetails(page);

  // Customer left unselected, a blank surname, and a malformed billing
  // address. The billing one is deliberately not a card field: the card is
  // checked in the browser and never gets as far as a rejection to list.
  await page.locator('input[name="passengers.0.firstName"]').fill("Aster");
  await page.locator('input[name="passengers.0.lastName"]').fill(" ");
  await page.locator('input[name="billingEmails"]').fill("not-an-email");

  await page.getByRole("button", { name: "Create booking" }).click();

  const guide = page.locator(GUIDE);
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("3 fields need attention");

  // Each entry carries its panel, and the row where there is one. The wording
  // is the schema's own, not a second copy written for the box.
  await expect(guide).toContainText("Booking details → Customer");
  await expect(guide).toContainText("Select a customer.");
  await expect(guide).toContainText(
    "Passenger information → Passenger 1 → Last name",
  );
  await expect(guide).toContainText("Enter a last name.");
  await expect(guide).toContainText("Billing information → Email ID");
  await expect(guide).toContainText(
    "One of those email addresses is not valid.",
  );
});

test("an entry opens the collapsed panel its field is hidden in", async ({
  page,
}) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/flight");

  // Every booking needs a card: the form will not submit without one.
  await fillCardDetails(page);

  await page.locator('select[name="customerId"]').selectOption(customer.id);
  await page.locator('input[name="passengers.0.firstName"]').fill("Aster");
  await page.locator('input[name="passengers.0.lastName"]').fill("Collapsed");

  // Gross fare is in Accounting information, which starts collapsed. Open it,
  // enter something the money parser rejects, then close it again — which is
  // exactly the state an operator ends up in, unable to see the problem.
  await page
    .getByRole("button", { name: "Expand Accounting information" })
    .click();
  await page.locator('input[name="baseFare"]').fill("not-a-number");
  await page
    .getByRole("button", { name: "Collapse Accounting information" })
    .click();

  await page.getByRole("button", { name: "Create booking" }).click();

  const guide = page.locator(GUIDE);
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("Accounting information → Gross fare");

  // The panel is still shut at this point, and a hidden field cannot take
  // focus — so the entry has to open it before focusing.
  await expect(
    page.getByRole("button", { name: "Expand Accounting information" }),
  ).toHaveCount(1);

  await guide.getByRole("button", { name: /Gross fare/ }).click();

  await expect(
    page.getByRole("button", { name: "Collapse Accounting information" }),
  ).toHaveCount(1);
  await expect(page.locator('input[name="baseFare"]')).toBeFocused();
});

test("it takes itself away, unless the pointer is on it", async ({ page }) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/flight");

  // Every booking needs a card: the form will not submit without one.
  await fillCardDetails(page);

  const guide = page.locator(GUIDE);

  await page.getByRole("button", { name: "Create booking" }).click();
  await expect(guide).toBeVisible();
  await expect(guide).toBeHidden({ timeout: 12_000 });

  // A second rejection brings it back, even though the errors are identical.
  await page.getByRole("button", { name: "Create booking" }).click();
  await expect(guide).toBeVisible();

  // Hovering holds it open past the point it would otherwise have gone.
  await guide.hover();
  await page.waitForTimeout(9_000);
  await expect(guide).toBeVisible();

  await page.mouse.move(0, 0);
  await expect(guide).toBeHidden({ timeout: 12_000 });
});

test("the close button dismisses it immediately", async ({ page }) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/flight");

  // Every booking needs a card: the form will not submit without one.
  await fillCardDetails(page);

  const guide = page.locator(GUIDE);
  await page.getByRole("button", { name: "Create booking" }).click();
  await expect(guide).toBeVisible();

  await guide.getByRole("button", { name: "Dismiss" }).click();
  await expect(guide).toBeHidden();
});

test("it stays quiet when the booking is accepted", async ({ page }) => {
  await signIn(page, operations);
  await page.goto("/admin/bookings/new/flight");

  // Every booking needs a card: the form will not submit without one.
  await fillCardDetails(page);

  await page.locator('select[name="customerId"]').selectOption(customer.id);
  await page.locator('input[name="passengers.0.firstName"]').fill("Aster");
  await page.locator('input[name="passengers.0.lastName"]').fill("Accepted");
  await page.locator('input[name="pnrLocator"]').fill("OK123");

  await page.getByRole("button", { name: "Create booking" }).click();

  // Asserting the redirect too: without it this would also pass if the
  // submission had failed and the box had simply never rendered.
  await page.waitForURL(/\/admin\/bookings\/[a-z0-9]+$/);
  await expect(page.locator(GUIDE)).toHaveCount(0);
});
